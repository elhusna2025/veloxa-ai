import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireWorkspace } from './auth';
import { resolveBusinessContext } from './business-contexts';
import { adminDb } from './firebase';
import { ApiError } from './http';
import { youtubeConfigForWorkspace, youtubeNotConfigured, type YouTubeConfig, type YouTubeEnv } from './youtube-config';
import { decryptYouTubeTokens, encryptYouTubeTokens } from './youtube-crypto';
import { youtubeChannelId } from './youtube-google';
import { connectionRecord, nonce, scopeInput } from './youtube-oauth';
import { assertWorkActive, type UploadWorkSignal } from './youtube-upload-deadline';
import { refreshYouTubeUploadGrant } from './youtube-upload-provider';
import { youtubeUploadNeedsPermission, youtubeUploadRefs, YouTubeUploadTokenRejected } from './youtube-upload-records';

export { assertSingleYouTubeUploadChannel } from './youtube-upload-provider';

export type YouTubeUploadBinding = { workspaceId: string; businessId: string; ownerUid: string; channelId: string; connectionRevision: string; grantId: string };
export type YouTubeUploadDependencies = {
  authorize?: typeof requireWorkspace;
  database?: ReturnType<typeof adminDb>;
  env?: YouTubeEnv;
  now?: () => number;
  fetcher?: typeof fetch;
};
type WorkspaceRef = FirebaseFirestore.DocumentReference;
type Tx = FirebaseFirestore.Transaction;
type ConfigIdentity = Pick<YouTubeConfig, 'clientId' | 'configBinding'>;
export const uploadConfigIdentity = ({ clientId, configBinding }: YouTubeConfig): ConfigIdentity => ({ clientId, configBinding });
export const matchesUploadConfig = (record: ConfigIdentity, config: YouTubeConfig) =>
  record.clientId === config.clientId && record.configBinding === config.configBinding;
export const uploadConfigFields = { clientId: z.string().min(1).max(512), configBinding: z.string().length(64).regex(/^[a-f0-9]+$/) };
export const uploadGeneration = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const uploadTargetSchema = scopeInput.extend({ ownerUid: z.string().min(1).max(128), channelId: youtubeChannelId, connectionRevision: nonce });
const bindingSchema = uploadTargetSchema.extend({ grantId: nonce });
export const uploadTokenFields = {
  ...uploadConfigFields, accessExpiresAt: uploadGeneration, encryptedTokens: z.string().min(1).max(24_000),
};
const refreshAttempt = z.object({ id: nonce, expiresAt: uploadGeneration, uncertain: z.literal(true).optional() }).strict();
const savedGrant = z.object({
  ...bindingSchema.shape, ...uploadTokenFields, permissionInvalidated: z.boolean().optional(),
  refreshAttempt: refreshAttempt.nullish(),
});
const refreshWindowMs = 60_000;
const refreshLeaseMs = 45_000;
const refreshInProgress = () => new ApiError(503, 'Izin unggah YouTube sedang diperbarui. Coba lagi sebentar.', 'youtube_upload_provider_unavailable');

type Target = Omit<YouTubeUploadBinding, 'grantId'>;
export const sameUploadTarget = (left: Target, right: Target) =>
  left.workspaceId === right.workspaceId && left.businessId === right.businessId && left.ownerUid === right.ownerUid &&
  left.channelId === right.channelId && left.connectionRevision === right.connectionRevision;

export async function requireYouTubeUploadBusiness(tx: Tx, ref: WorkspaceRef, ownerUid: string, businessId: string) {
  const workspace = (await tx.get(ref)).data();
  if (!workspace || !ownerUid || workspace.ownerUid !== ownerUid) {
    throw new ApiError(403, 'Tindakan ini hanya dapat dilakukan oleh pemilik workspace.', 'forbidden');
  }
  const { context } = await resolveBusinessContext(ref, workspace, businessId, tx);
  if (context.id !== businessId) throw new ApiError(409, 'Bisnis tidak ditemukan.', 'business_context_invalid');
}

export async function readYouTubeUploadConnection(tx: Tx, ref: WorkspaceRef, businessId: string) {
  const parsed = connectionRecord.safeParse((await tx.get(ref.collection('private_youtube_connections').doc(businessId))).data());
  return parsed.success ? parsed.data : null;
}

export function requireYouTubeUploadTarget(connection: Awaited<ReturnType<typeof readYouTubeUploadConnection>>, target: Target, config: YouTubeConfig) {
  // Izin unggah terikat pada pemilik saat ini dan revisi koneksi, bukan pada aktor yang dahulu memberi izin baca.
  if (!connection || !matchesUploadConfig(connection, config) || connection.channelId !== target.channelId ||
    connection.authorizationId !== target.connectionRevision || !config.allowedWorkspaceIds.includes(target.workspaceId)) {
    throw youtubeUploadNeedsPermission();
  }
  return connection;
}

function tokenIdentity(binding: YouTubeUploadBinding, config: YouTubeConfig, purpose: 'pending' | 'grant') {
  const { workspaceId, businessId, ownerUid, channelId, connectionRevision, grantId } = binding;
  const digest = createHash('sha256').update(JSON.stringify([
    'youtube-upload-v1', purpose, workspaceId, businessId, ownerUid, channelId, connectionRevision, grantId,
    config.clientId, config.configBinding,
  ])).digest('hex');
  return { workspaceId, businessId, authorizationId: `upload:${digest}` };
}

export function encryptUploadTokens(tokens: Parameters<typeof encryptYouTubeTokens>[0], binding: YouTubeUploadBinding, config: YouTubeConfig, purpose: 'pending' | 'grant') {
  return encryptYouTubeTokens(tokens, tokenIdentity(binding, config, purpose), config.encryptionKey);
}

export function decryptUploadTokens(encryptedTokens: string, binding: YouTubeUploadBinding, config: YouTubeConfig, purpose: 'pending' | 'grant') {
  try { return decryptYouTubeTokens(encryptedTokens, tokenIdentity(binding, config, purpose), config.encryptionKey); }
  catch { throw youtubeUploadNeedsPermission(); }
}

function matchingUploadGrant(raw: unknown, target: Target, config: YouTubeConfig) {
  const parsed = savedGrant.safeParse(raw);
  if (!parsed.success || parsed.data.permissionInvalidated || !sameUploadTarget(parsed.data, target) || !matchesUploadConfig(parsed.data, config)) return null;
  return parsed.data;
}

export function currentYouTubeUploadGrant(raw: unknown, target: Target, config: YouTubeConfig) {
  const grant = matchingUploadGrant(raw, target, config);
  return grant?.refreshAttempt?.uncertain ? null : grant;
}

async function readBoundGrant(tx: Tx, ref: WorkspaceRef, binding: YouTubeUploadBinding, config: YouTubeConfig, completingAttempt?: string) {
  if (!bindingSchema.safeParse(binding).success || ref.id !== binding.workspaceId) throw youtubeUploadNeedsPermission();
  try { await requireYouTubeUploadBusiness(tx, ref, binding.ownerUid, binding.businessId); }
  catch (error) { if (error instanceof ApiError) throw youtubeUploadNeedsPermission(); throw error; }
  const connection = await readYouTubeUploadConnection(tx, ref, binding.businessId);
  requireYouTubeUploadTarget(connection, binding, config);
  const { grant } = youtubeUploadRefs(ref, binding.businessId);
  const saved = matchingUploadGrant((await tx.get(grant)).data(), binding, config);
  if (!saved || saved.grantId !== binding.grantId ||
    (saved.refreshAttempt?.uncertain && saved.refreshAttempt.id !== completingAttempt)) throw youtubeUploadNeedsPermission();
  const tokens = decryptUploadTokens(saved.encryptedTokens, binding, config, 'grant');
  return { grant, saved, tokens };
}

export async function assertYouTubeUploadBinding(tx: Tx, workspaceRef: WorkspaceRef, binding: YouTubeUploadBinding, config: YouTubeConfig): Promise<void> {
  await readBoundGrant(tx, workspaceRef, binding, config);
}

// A replacement grant can only be selected for a video whose ID is already known.
export async function readYouTubeVideoStatusBinding(tx: Tx, ref: WorkspaceRef, target: Target, config: YouTubeConfig): Promise<YouTubeUploadBinding> {
  const { workspaceId, businessId, ownerUid, channelId, connectionRevision } = target;
  const identity = uploadTargetSchema.safeParse({ workspaceId, businessId, ownerUid, channelId, connectionRevision });
  if (!identity.success || ref.id !== identity.data.workspaceId) throw youtubeUploadNeedsPermission();
  const { grant } = youtubeUploadRefs(ref, identity.data.businessId);
  const approved = currentYouTubeUploadGrant((await tx.get(grant)).data(), identity.data, config);
  if (!approved) throw youtubeUploadNeedsPermission();
  const binding = { ...identity.data, grantId: approved.grantId };
  await readBoundGrant(tx, ref, binding, config);
  return binding;
}

export async function getYouTubeUploadAccess(request: Request, workspaceId: string, businessId: string, deps: YouTubeUploadDependencies = {}): Promise<{
  ref: WorkspaceRef; user: { uid: string }; binding: YouTubeUploadBinding; config: YouTubeConfig;
}> {
  const scope = scopeInput.parse({ workspaceId, businessId });
  const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, scope.workspaceId, true);
  return ref.firestore.runTransaction(async tx => {
    await requireYouTubeUploadBusiness(tx, ref, user.uid, scope.businessId);
    const config = youtubeConfigForWorkspace(scope.workspaceId, deps.env);
    if (!config) throw youtubeNotConfigured();
    const connection = await readYouTubeUploadConnection(tx, ref, scope.businessId);
    if (!connection) throw youtubeUploadNeedsPermission();
    const target = { ...scope, ownerUid: user.uid, channelId: connection.channelId, connectionRevision: connection.authorizationId };
    requireYouTubeUploadTarget(connection, target, config);
    const { grant } = youtubeUploadRefs(ref, scope.businessId);
    const saved = currentYouTubeUploadGrant((await tx.get(grant)).data(), target, config);
    if (!saved) throw youtubeUploadNeedsPermission();
    const binding = { ...target, grantId: saved.grantId };
    decryptUploadTokens(saved.encryptedTokens, binding, config, 'grant');
    return { ref, user: { uid: user.uid }, binding, config };
  });
}

export async function loadYouTubeUploadCredentials(
  binding: YouTubeUploadBinding,
  deps: YouTubeUploadDependencies = {},
  rejectedAccessToken?: string,
  signal?: UploadWorkSignal,
): Promise<{ accessToken: string; config: YouTubeConfig }> {
  assertWorkActive(signal);
  const parsed = bindingSchema.safeParse(binding);
  if (!parsed.success) throw youtubeUploadNeedsPermission();
  const identity = parsed.data;
  const db = deps.database ?? adminDb();
  const ref = db.collection('workspaces').doc(identity.workspaceId);
  const now = deps.now ?? Date.now;
  const currentConfig = () => {
    const config = youtubeConfigForWorkspace(identity.workspaceId, deps.env);
    if (!config) throw youtubeUploadNeedsPermission();
    return config;
  };
  const attemptId = randomBytes(32).toString('base64url');
  const claim = await db.runTransaction(async tx => {
    const config = currentConfig();
    const current = await readBoundGrant(tx, ref, identity, config);
    assertWorkActive(signal);
    const attempt = current.saved.refreshAttempt;
    if (attempt) {
      if (attempt.expiresAt > now()) throw refreshInProgress();
      // The provider may already have consumed a refresh token. Expiration never reopens the attempt.
      tx.update(current.grant, { refreshAttempt: { ...attempt, uncertain: true } });
      return { state: 'reauthorize' } as const;
    }
    if (current.tokens.accessToken !== rejectedAccessToken && current.saved.accessExpiresAt > now() + refreshWindowMs) {
      return { state: 'cached', accessToken: current.tokens.accessToken, config } as const;
    }
    const expiresAt = now() + refreshLeaseMs;
    tx.update(current.grant, { refreshAttempt: { id: attemptId, expiresAt } });
    return { state: 'claimed', ...current, config, expiresAt } as const;
  });
  if (claim.state === 'cached') return { accessToken: claim.accessToken, config: claim.config };
  if (claim.state === 'reauthorize') throw youtubeUploadNeedsPermission();

  const readRefreshAttempt = async (tx: Tx) => {
    const config = currentConfig();
    if (!matchesUploadConfig(claim.config, config)) throw youtubeUploadNeedsPermission();
    const current = await readBoundGrant(tx, ref, identity, config, attemptId);
    const attempt = current.saved.refreshAttempt;
    if (attempt?.id !== attemptId || current.saved.encryptedTokens !== claim.saved.encryptedTokens ||
      current.saved.accessExpiresAt !== claim.saved.accessExpiresAt) throw youtubeUploadNeedsPermission();
    return { grant: current.grant, attempt, config };
  };

  const assertRefreshLease = () => {
    assertWorkActive(signal);
    if (claim.expiresAt <= now()) throw refreshInProgress();
  };
  let dispatched = false;
  const fetcher: typeof fetch = (...args) => {
    assertRefreshLease();
    dispatched = true;
    return (deps.fetcher ?? fetch)(...args);
  };
  let renewed: Awaited<ReturnType<typeof refreshYouTubeUploadGrant>>;
  try {
    assertRefreshLease();
    // Once sent, the provider's own deadline allows a conclusive rotation to settle.
    renewed = await refreshYouTubeUploadGrant(claim.config, claim.tokens.refreshToken, { fetcher, now });
  } catch (error) {
    if (!dispatched) {
      await db.runTransaction(async tx => {
        const { grant } = await readRefreshAttempt(tx);
        tx.update(grant, { refreshAttempt: null });
      }).catch(() => {});
      throw error;
    }
    await db.runTransaction(async tx => {
      const current = await readRefreshAttempt(tx);
      if (error instanceof YouTubeUploadTokenRejected) {
        tx.update(current.grant, { permissionInvalidated: true, refreshAttempt: null });
      } else if (!current.attempt.uncertain) {
        tx.update(current.grant, { refreshAttempt: { ...current.attempt, uncertain: true } });
      }
    });
    throw youtubeUploadNeedsPermission();
  }

  const result = await db.runTransaction(async tx => {
    const { grant, config } = await readRefreshAttempt(tx);
    // A conclusive result can settle its own attempt after the lease deadline.
    tx.update(grant, {
      encryptedTokens: encryptUploadTokens(renewed.tokens, identity, config, 'grant'),
      accessExpiresAt: renewed.accessExpiresAt,
      refreshAttempt: null,
    });
    return { accessToken: renewed.tokens.accessToken, config };
  });
  if (renewed.accessExpiresAt <= now()) throw refreshInProgress();
  return result;
}

// The transaction compares the rejected token before marking the approved grant unusable.
export async function invalidateYouTubeUploadAccessToken(
  binding: YouTubeUploadBinding, rejectedAccessToken: string, deps: YouTubeUploadDependencies = {},
) {
  const config = youtubeConfigForWorkspace(binding.workspaceId, deps.env);
  if (!config) throw youtubeUploadNeedsPermission();
  const db = deps.database ?? adminDb();
  const ref = db.collection('workspaces').doc(binding.workspaceId);
  return db.runTransaction(async tx => {
    const current = await readBoundGrant(tx, ref, binding, config);
    if (current.saved.refreshAttempt || current.tokens.accessToken !== rejectedAccessToken) return false;
    tx.update(current.grant, { permissionInvalidated: true });
    return true;
  });
}
