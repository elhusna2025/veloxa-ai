import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isVerifiedAdmin } from '../veloxa-workspace-policy';
import { hasWorkspaceAccess, requireWorkspace, workspaceIdSchema } from './auth';
import { resolveBusinessContext } from './business-contexts';
import { adminDb } from './firebase';
import { ApiError, errorResponse, noStoreJson, readJson } from './http';
import { attachOAuthBrowserState, clearOAuthBrowserState, verifyOAuthBrowserState } from './oauth-browser-state';
import { YOUTUBE_CALLBACK_PATH, YOUTUBE_READONLY_SCOPE, youtubeConfigForWorkspace, youtubeNotConfigured, youtubeRedirect, type YouTubeConfig, type YouTubeEnv } from './youtube-config';
import { encryptYouTubeTokens } from './youtube-crypto';
import { assertNoYouTubeUploadDispatch } from './youtube-upload-dispatch';
import { youtubeUploadRefs } from './youtube-upload-records';
import { buildYouTubeAuthorizeUrl, exchangeYouTubeGrant, publicYouTubeChannel, youtubeChannel, youtubeChannelId, YOUTUBE_CHANNEL_LIMIT } from './youtube-google';

const ttlMs = 10 * 60_000;
export const nonce = z.string().length(43).regex(/^[A-Za-z0-9_-]{43}$/);
const identifier = () => randomBytes(32).toString('base64url');
const stateDigest = (state: string) => createHash('sha256').update(state).digest('hex');
export const scopeInput = z.object({
  workspaceId: workspaceIdSchema,
  businessId: z.string().refine(value => value === 'primary' || (value.length === 38 && /^b_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))),
}).strict();
const selectionInput = scopeInput.extend({ authorizationId: nonce, channelId: youtubeChannelId });
const disconnectInput = scopeInput.extend({ channelId: youtubeChannelId, revision: nonce });
const generationSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const startInput = scopeInput.extend({ startRevision: generationSchema });
const timestamp = z.number().int().nonnegative();
const configFields = {
  clientId: z.string().min(1).max(512), configBinding: z.string().length(64),
};
const stateRecord = scopeInput.extend({
  ...configFields, uid: z.string().min(1).max(128), generation: generationSchema,
  redirectUri: z.string().max(2048), expiresAt: timestamp, verifier: nonce,
  // Firestore interprets this optional retention field. Logical expiry uses expiresAt.
  deleteAt: z.unknown().optional(),
  browserSecretDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const grantFields = {
  ...configFields, authorizationId: nonce, authorizedBy: z.string().min(1).max(128), generation: generationSchema,
  scope: z.literal(YOUTUBE_READONLY_SCOPE), accessExpiresAt: timestamp, encryptedTokens: z.string().min(1).max(24_000),
};
const pendingRecord = z.object({ ...grantFields, expiresAt: timestamp, channels: z.array(youtubeChannel).min(1).max(YOUTUBE_CHANNEL_LIMIT) });
export const connectionRecord = youtubeChannel.extend({ ...grantFields, connectedAt: timestamp });

type Dependencies = {
  authorize?: typeof requireWorkspace;
  database?: ReturnType<typeof adminDb>;
  encrypt?: typeof encryptYouTubeTokens;
  fetcher?: typeof fetch;
  now?: () => number;
  env?: YouTubeEnv;
};
type WorkspaceRef = Awaited<ReturnType<typeof requireWorkspace>>['ref'];
type Tx = FirebaseFirestore.Transaction;
type ConfigBinding = Pick<YouTubeConfig, 'clientId' | 'configBinding'>;
const matchesConfig = (record: ConfigBinding, config: YouTubeConfig) => record.clientId === config.clientId && record.configBinding === config.configBinding;
const binding = ({ clientId, configBinding }: YouTubeConfig) => ({ clientId, configBinding });
const forbidden = () => new ApiError(403, 'Tindakan ini hanya dapat dilakukan oleh pemilik workspace.', 'forbidden');
const reconnect = () => new ApiError(409, 'Sesi koneksi YouTube tidak lagi berlaku. Mulai kembali dari Veloxa.', 'reconnect_required');
const invalidCallback = () => new ApiError(400, 'Callback YouTube tidak valid.', 'invalid_youtube_callback');

function refs(ref: WorkspaceRef, businessId: string) {
  const connections = ref.collection('private_youtube_connections');
  return {
    connections, connection: connections.doc(businessId),
    pending: ref.collection('private_youtube_authorizations').doc(businessId),
    guard: ref.collection('integration_guards').doc(`youtube_${businessId}`),
  };
}

async function ownerBusiness(tx: Tx, ref: WorkspaceRef, uid: string, businessId: string) {
  const workspace = (await tx.get(ref)).data();
  if (!workspace || workspace.ownerUid !== uid) throw forbidden();
  await resolveBusinessContext(ref, workspace, businessId, tx);
}

async function generation(tx: Tx, guard: WorkspaceRef) {
  const data = (await tx.get(guard)).data();
  if (data === undefined) return 0;
  const parsed = generationSchema.safeParse(data.generation);
  if (!parsed.success) throw reconnect();
  return parsed.data;
}

function nextGeneration(current: number) {
  if (current >= Number.MAX_SAFE_INTEGER) throw reconnect();
  return current + 1;
}

function currentPending(raw: unknown, ownerUid: unknown, current: number, config: YouTubeConfig, now: number) {
  const result = pendingRecord.safeParse(raw);
  if (!result.success) return null;
  const pending = result.data;
  return pending.authorizedBy === ownerUid && pending.generation === current && pending.expiresAt > now && matchesConfig(pending, config) ? pending : null;
}

async function youtubeJson(run: () => Promise<NextResponse>) {
  try { return await run(); }
  catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export function startYouTube(request: Request, deps: Dependencies = {}) {
  return youtubeJson(async () => {
    const { workspaceId, businessId, startRevision } = startInput.parse(await readJson(request, 4096));
    const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, workspaceId, true);
    const { guard, pending } = refs(ref, businessId);
    const state = identifier();
    const verifier = identifier();
    const browserSecret = identifier();
    const db = ref.firestore;
    const stateRef = db.collection('_youtube_oauth_states').doc(stateDigest(state));
    const url = await db.runTransaction(async tx => {
      await ownerBusiness(tx, ref, user.uid, businessId);
      const config = youtubeConfigForWorkspace(workspaceId, deps.env);
      if (!config) throw youtubeNotConfigured();
      const current = await generation(tx, guard);
      if (current !== startRevision) {
        throw new ApiError(409, 'Sesi koneksi YouTube telah berubah. Muat ulang daftar sebelum memulai kembali.', 'youtube_start_conflict');
      }
      const next = nextGeneration(current);
      const expiresAt = (deps.now ?? Date.now)() + ttlMs;
      // Percobaan baru membatalkan pilihan tertunda, bukan koneksi yang sudah disimpan.
      tx.set(guard, { generation: next });
      tx.delete(pending);
      tx.create(stateRef, {
        uid: user.uid, workspaceId: ref.id, businessId, generation: next, ...binding(config),
        redirectUri: config.redirectUri, verifier, browserSecretDigest: stateDigest(browserSecret),
        expiresAt, deleteAt: new Date(expiresAt),
      });
      return buildYouTubeAuthorizeUrl(config, state, verifier);
    });
    return attachOAuthBrowserState(noStoreJson({ ok: true, url }), url, 'youtube', browserSecret);
  });
}

async function finishYouTube(request: Request, url: URL, state: string, deps: Dependencies, onBrowserVerified: () => void) {
  const db = deps.database ?? adminDb();
  const now = deps.now ?? Date.now;
  const stateRef = db.collection('_youtube_oauth_states').doc(stateDigest(state));
  const { actor, config } = await db.runTransaction(async tx => {
    const parsed = stateRecord.safeParse((await tx.get(stateRef)).data());
    if (!parsed.success) throw reconnect();
    // The cookie secret is independent of the public authorize URL. Validate
    // its stored digest before consuming state, within the same transaction.
    verifyOAuthBrowserState(request, 'youtube', parsed.data.browserSecretDigest);
    const activeConfig = youtubeConfigForWorkspace(parsed.data.workspaceId, deps.env);
    if (!activeConfig) throw reconnect();
    tx.delete(stateRef);
    return { actor: parsed.data, config: activeConfig };
  });
  onBrowserVerified();
  // Penghapusan sudah dikomit; pembatalan atau kegagalan berikutnya tidak dapat memutar ulang state.
  if (actor.expiresAt <= now() || !matchesConfig(actor, config) || actor.redirectUri !== config.redirectUri) throw reconnect();
  if (url.searchParams.has('error')) throw invalidCallback();
  const code = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/).parse(url.searchParams.get('code'));
  const { uid, workspaceId, businessId, verifier, expiresAt, generation: consentGeneration } = actor;
  const ref = db.collection('workspaces').doc(workspaceId);
  const { guard, pending } = refs(ref, businessId);
  const recheck = async (tx: Tx) => {
    await ownerBusiness(tx, ref, uid, businessId);
    const current = await generation(tx, guard);
    const activeConfig = youtubeConfigForWorkspace(workspaceId, deps.env);
    if (current !== consentGeneration || expiresAt <= now() || !activeConfig || !matchesConfig(config, activeConfig)) throw reconnect();
    return current;
  };

  await db.runTransaction(recheck);
  const grant = await exchangeYouTubeGrant(config, code, verifier, { fetcher: deps.fetcher, now });
  const authorizationId = identifier();
  const encryptedTokens = (deps.encrypt ?? encryptYouTubeTokens)(grant.tokens, { workspaceId, businessId, authorizationId }, config.encryptionKey);
  await db.runTransaction(async tx => {
    const current = await recheck(tx);
    const pendingExpiresAt = now() + ttlMs;
    tx.set(pending, {
      ...binding(config), authorizationId, channels: grant.channels, authorizedBy: uid, generation: current,
      expiresAt: pendingExpiresAt, deleteAt: new Date(pendingExpiresAt),
      scope: YOUTUBE_READONLY_SCOPE, accessExpiresAt: grant.accessExpiresAt, encryptedTokens,
    });
  });
}

export async function youtubeCallback(request: Request, deps: Dependencies = {}) {
  const redirect = youtubeRedirect(deps.env);
  let status: 'authorized' | 'failed' = 'failed';
  let verifiedState: string | null = null;
  if (redirect) {
    try {
      const url = new URL(request.url);
      const states = url.searchParams.getAll('state');
      if ((url.pathname !== YOUTUBE_CALLBACK_PATH && url.pathname !== `${YOUTUBE_CALLBACK_PATH}/`) || states.length !== 1 || url.searchParams.getAll('code').length > 1) throw invalidCallback();
      const state = nonce.parse(states[0]);
      await finishYouTube(request, url, state, deps, () => { verifiedState = state; });
      status = 'authorized';
    } catch { /* Respons tidak mengungkapkan parameter atau alasan kegagalan dari Google. */ }
  }
  const response = redirect
    ? NextResponse.redirect(new URL(`/?youtube=${status}`, redirect.origin), 303)
    : errorResponse(youtubeNotConfigured());
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return verifiedState ? clearOAuthBrowserState(response, 'youtube', verifiedState) : response;
}

export function youtubeAccounts(request: Request, deps: Dependencies = {}) {
  return youtubeJson(async () => {
    const query = new URL(request.url).searchParams;
    if (query.getAll('workspaceId').length !== 1 || query.getAll('businessId').length !== 1) throw new ApiError(400, 'Workspace dan bisnis harus ditentukan satu kali.', 'invalid_request');
    const { workspaceId, businessId } = scopeInput.parse({ workspaceId: query.get('workspaceId'), businessId: query.get('businessId') });
    const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, workspaceId);
    const { connection, pending, guard } = refs(ref, businessId);
    const result = await ref.firestore.runTransaction(async tx => {
      const workspace = (await tx.get(ref)).data();
      if (!workspace || !hasWorkspaceAccess(user.uid, workspace, isVerifiedAdmin(user))) throw forbidden();
      await resolveBusinessContext(ref, workspace, businessId, tx);
      const config = youtubeConfigForWorkspace(workspaceId, deps.env);
      const saved = connectionRecord.safeParse((await tx.get(connection)).data());
      const startRevision = await generation(tx, guard);
      const grant = config ? currentPending((await tx.get(pending)).data(), workspace.ownerUid, startRevision, config, (deps.now ?? Date.now)()) : null;
      return {
        ok: true, configured: config !== null, startRevision,
        connection: saved.success ? {
          ...publicYouTubeChannel(saved.data), connectedAt: saved.data.connectedAt, revision: saved.data.authorizationId,
          status: config && saved.data.authorizedBy === workspace.ownerUid && matchesConfig(saved.data, config) ? 'connected' : 'reconnect_required',
        } : null,
        channels: grant ? grant.channels.map(publicYouTubeChannel) : [],
        ...(grant ? { authorizationId: grant.authorizationId } : {}),
      };
    });
    return noStoreJson(result);
  });
}

export function selectYouTubeConnection(request: Request, deps: Dependencies = {}) {
  return youtubeJson(async () => {
    const { workspaceId, businessId, authorizationId, channelId } = selectionInput.parse(await readJson(request, 4096));
    const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, workspaceId, true);
    const { pending, guard, connection, connections } = refs(ref, businessId);
    const now = deps.now ?? Date.now;
    await ref.firestore.runTransaction(async tx => {
      await ownerBusiness(tx, ref, user.uid, businessId);
      const config = youtubeConfigForWorkspace(workspaceId, deps.env);
      if (!config) throw youtubeNotConfigured();
      const current = await generation(tx, guard);
      const raw = (await tx.get(pending)).data();
      const assigned = await tx.get(connections.where('channelId', '==', channelId));
      const grant = currentPending(raw, user.uid, current, config, now());
      if (!grant || grant.authorizationId !== authorizationId) throw reconnect();
      const channel = grant.channels.find(option => option.channelId === channelId);
      if (!channel) throw new ApiError(409, 'Kanal tidak tercantum dalam izin YouTube ini.', 'youtube_channel_not_authorized');
      if (assigned.docs.some(doc => doc.id !== businessId)) throw new ApiError(409, 'Kanal YouTube sudah terhubung ke bisnis lain di workspace ini.', 'youtube_channel_assigned');
      await assertNoYouTubeUploadDispatch(tx, ref, businessId);
      const next = nextGeneration(current);
      const upload = youtubeUploadRefs(ref, businessId);
      tx.delete(upload.grant);
      tx.delete(upload.pending);
      tx.set(guard, { generation: next });
      tx.set(connection, {
        ...publicYouTubeChannel(channel), ...binding(config), authorizationId, authorizedBy: user.uid,
        generation: next, scope: grant.scope, accessExpiresAt: grant.accessExpiresAt, encryptedTokens: grant.encryptedTokens, connectedAt: now(),
      });
      tx.delete(pending);
    });
    return noStoreJson({ ok: true });
  });
}

export function disconnectYouTube(request: Request, deps: Dependencies = {}) {
  return youtubeJson(async () => {
    const { workspaceId, businessId, channelId, revision } = disconnectInput.parse(await readJson(request, 4096));
    const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, workspaceId, true);
    const { pending, guard, connection } = refs(ref, businessId);
    await ref.firestore.runTransaction(async tx => {
      await ownerBusiness(tx, ref, user.uid, businessId);
      const saved = (await tx.get(connection)).data();
      if (saved === undefined) return;
      if (saved.channelId !== channelId || saved.authorizationId !== revision) {
        throw new ApiError(409, 'Koneksi YouTube telah berubah. Muat ulang daftar sebelum memutuskan koneksi.', 'youtube_connection_conflict');
      }
      const next = nextGeneration(await generation(tx, guard));
      await assertNoYouTubeUploadDispatch(tx, ref, businessId);
      const upload = youtubeUploadRefs(ref, businessId);
      tx.delete(upload.grant);
      tx.delete(upload.pending);
      tx.set(guard, { generation: next });
      tx.delete(connection);
      tx.delete(pending);
    });
    return noStoreJson({ ok: true });
  });
}
