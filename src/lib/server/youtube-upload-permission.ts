import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { YouTubeUploadPermission } from '../youtube-upload-types';
import { requireWorkspace } from './auth';
import { adminDb } from './firebase';
import { ApiError, errorResponse, noStoreJson, readJson } from './http';
import { attachOAuthBrowserState, clearOAuthBrowserState, verifyOAuthBrowserState } from './oauth-browser-state';
import { YOUTUBE_CALLBACK_PATH, youtubeConfigForWorkspace, youtubeNotConfigured, youtubeRedirect, type YouTubeConfig } from './youtube-config';
import { publicYouTubeChannel } from './youtube-google';
import { nonce, scopeInput, youtubeCallback } from './youtube-oauth';
import {
  currentYouTubeUploadGrant, decryptUploadTokens, encryptUploadTokens, matchesUploadConfig,
  readYouTubeUploadConnection, requireYouTubeUploadBusiness, requireYouTubeUploadTarget, sameUploadTarget,
  uploadConfigFields, uploadConfigIdentity, uploadGeneration, uploadTargetSchema, uploadTokenFields,
  type YouTubeUploadDependencies,
} from './youtube-upload-auth';
import { assertNoYouTubeUploadDispatch } from './youtube-upload-dispatch';
import { buildYouTubeUploadAuthorizeUrl, exchangeYouTubeUploadGrant } from './youtube-upload-provider';
import { youtubeUploadNeedsPermission, youtubeUploadRefs } from './youtube-upload-records';

const ttlMs = 10 * 60_000;
const identifier = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const targetInput = scopeInput.extend({ channelId: uploadTargetSchema.shape.channelId, connectionRevision: nonce });
const startInput = targetInput.extend({ startRevision: uploadGeneration });
const confirmInput = targetInput.extend({ authorizationId: nonce });
const stateSchema = uploadTargetSchema.extend({
  ...uploadConfigFields, generation: uploadGeneration, redirectUri: z.string().max(2048), verifier: nonce,
  browserSecretDigest: z.string().length(64).regex(/^[a-f0-9]+$/), expiresAt: uploadGeneration, deleteAt: z.unknown().optional(),
});
const pendingSchema = uploadTargetSchema.extend({
  ...uploadTokenFields, authorizationId: nonce, generation: uploadGeneration, expiresAt: uploadGeneration, deleteAt: z.unknown().optional(),
});
type Target = z.infer<typeof uploadTargetSchema>;
type Tx = FirebaseFirestore.Transaction;
type Doc = FirebaseFirestore.DocumentReference;

function uploadStateRef(db: ReturnType<typeof adminDb>, state: string) {
  return db.collection('_youtube_upload_oauth_states').doc(digest(state));
}

async function readGeneration(tx: Tx, guard: Doc) {
  const record = (await tx.get(guard)).data();
  if (!record) return 0;
  const parsed = uploadGeneration.safeParse(record.generation);
  if (!parsed.success) throw youtubeUploadNeedsPermission();
  return parsed.data;
}

function currentPending(raw: unknown, target: Target, config: YouTubeConfig, generation: number, now: number) {
  const parsed = pendingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const pending = parsed.data;
  return pending.generation === generation && pending.expiresAt > now && sameUploadTarget(pending, target) && matchesUploadConfig(pending, config) ? pending : null;
}

// Khusus pemeriksaan sesi final yang dipagari; tidak mengganti grant atau mengonsumsi persetujuan.
export async function readYouTubeUploadReviewCredentials(tx: Tx, ref: Doc, target: Target, config: YouTubeConfig, now: () => number) {
  if (ref.id !== target.workspaceId) throw youtubeUploadNeedsPermission();
  await requireYouTubeUploadBusiness(tx, ref, target.ownerUid, target.businessId);
  requireYouTubeUploadTarget(await readYouTubeUploadConnection(tx, ref, target.businessId), target, config);
  const { pending, guard } = youtubeUploadRefs(ref, target.businessId);
  const generation = await readGeneration(tx, guard);
  const snapshot = await tx.get(pending);
  const checkedAt = now();
  const review = currentPending(snapshot.data(), target, config, generation, checkedAt);
  if (!review || review.accessExpiresAt <= checkedAt) return null;
  const tokens = decryptUploadTokens(review.encryptedTokens, { ...target, grantId: review.authorizationId }, config, 'pending');
  return { accessToken: tokens.accessToken, config };
}

async function permissionJson(run: () => Promise<NextResponse>) {
  try { return await run(); }
  catch (error) {
    const response = errorResponse(error instanceof ApiError || error instanceof z.ZodError ? error :
      new ApiError(500, 'Izin unggah YouTube belum dapat diperiksa. Coba lagi.', 'youtube_upload_unavailable'));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export function getYouTubeUploadPermission(request: Request, deps: YouTubeUploadDependencies = {}) {
  return permissionJson(async () => {
    const query = new URL(request.url).searchParams;
    if (query.getAll('workspaceId').length !== 1 || query.getAll('businessId').length !== 1) {
      throw new ApiError(400, 'Workspace dan bisnis harus ditentukan satu kali.', 'invalid_request');
    }
    const scope = scopeInput.parse({ workspaceId: query.get('workspaceId'), businessId: query.get('businessId') });
    const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, scope.workspaceId, true);
    const { grant, pending, guard } = youtubeUploadRefs(ref, scope.businessId);
    const result = await ref.firestore.runTransaction<YouTubeUploadPermission>(async tx => {
      await requireYouTubeUploadBusiness(tx, ref, user.uid, scope.businessId);
      const config = youtubeConfigForWorkspace(scope.workspaceId, deps.env);
      const saved = await readYouTubeUploadConnection(tx, ref, scope.businessId);
      const startRevision = await readGeneration(tx, guard);
      const dto: YouTubeUploadPermission = { ok: true, configured: config !== null, connection: null, canUpload: false,
        uploadStorageReady: (deps.env ?? process.env).YOUTUBE_UPLOAD_STORAGE_RETENTION_READY === 'true', startRevision };
      if (!saved) return dto;
      const channel = publicYouTubeChannel(saved);
      dto.connection = { ...channel, revision: saved.authorizationId, status: 'reconnect_required' };
      if (!config || !matchesUploadConfig(saved, config)) return dto;
      dto.connection.status = 'connected';
      const target = { ...scope, ownerUid: user.uid, channelId: saved.channelId, connectionRevision: saved.authorizationId };
      const approved = currentYouTubeUploadGrant((await tx.get(grant)).data(), target, config);
      if (approved) {
        try { decryptUploadTokens(approved.encryptedTokens, { ...target, grantId: approved.grantId }, config, 'grant'); dto.canUpload = true; }
        catch { /* Kredensial yang tidak autentik tidak dianggap sebagai izin. */ }
      }
      const review = currentPending((await tx.get(pending)).data(), target, config, startRevision, (deps.now ?? Date.now)());
      if (review) dto.pending = { ...channel, authorizationId: review.authorizationId, connectionRevision: saved.authorizationId };
      return dto;
    });
    return noStoreJson(result);
  });
}

export function startYouTubeUploadPermission(request: Request, deps: YouTubeUploadDependencies = {}) {
  return permissionJson(async () => {
    const { startRevision, ...input } = startInput.parse(await readJson(request, 4096));
    const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, input.workspaceId, true);
    const target = { ...input, ownerUid: user.uid };
    const { pending, guard } = youtubeUploadRefs(ref, input.businessId);
    const state = identifier();
    const verifier = identifier();
    const browserSecret = identifier();
    const stateRef = uploadStateRef(ref.firestore, state);
    const url = await ref.firestore.runTransaction(async tx => {
      await requireYouTubeUploadBusiness(tx, ref, user.uid, input.businessId);
      const config = youtubeConfigForWorkspace(input.workspaceId, deps.env);
      if (!config) throw youtubeNotConfigured();
      const saved = await readYouTubeUploadConnection(tx, ref, input.businessId);
      requireYouTubeUploadTarget(saved, target, config);
      const current = await readGeneration(tx, guard);
      if (startRevision !== current || current === Number.MAX_SAFE_INTEGER) {
        throw new ApiError(409, 'Sesi izin unggah telah berubah. Muat ulang sebelum melanjutkan.', 'youtube_upload_start_conflict');
      }
      const generation = current + 1;
      const expiresAt = (deps.now ?? Date.now)() + ttlMs;
      tx.set(guard, { generation });
      tx.delete(pending);
      tx.create(stateRef, {
        ...target, ...uploadConfigIdentity(config), generation, redirectUri: config.redirectUri, verifier,
        browserSecretDigest: digest(browserSecret), expiresAt, deleteAt: new Date(expiresAt),
      });
      return buildYouTubeUploadAuthorizeUrl(config, state, verifier);
    });
    return attachOAuthBrowserState(noStoreJson({ ok: true, url }), url, 'youtube', browserSecret);
  });
}

export function confirmYouTubeUploadPermission(request: Request, deps: YouTubeUploadDependencies = {}) {
  return permissionJson(async () => {
    const { authorizationId, ...input } = confirmInput.parse(await readJson(request, 4096));
    const { ref, user } = await (deps.authorize ?? requireWorkspace)(request, input.workspaceId, true);
    const target = { ...input, ownerUid: user.uid };
    const { grant, pending, guard } = youtubeUploadRefs(ref, input.businessId);
    const grantId = identifier();
    await ref.firestore.runTransaction(async tx => {
      await requireYouTubeUploadBusiness(tx, ref, user.uid, input.businessId);
      await assertNoYouTubeUploadDispatch(tx, ref, input.businessId);
      const config = youtubeConfigForWorkspace(input.workspaceId, deps.env);
      if (!config) throw youtubeNotConfigured();
      const saved = await readYouTubeUploadConnection(tx, ref, input.businessId);
      requireYouTubeUploadTarget(saved, target, config);
      const generation = await readGeneration(tx, guard);
      const review = currentPending((await tx.get(pending)).data(), target, config, generation, (deps.now ?? Date.now)());
      if (!review || review.authorizationId !== authorizationId) throw youtubeUploadNeedsPermission();
      const tokens = decryptUploadTokens(review.encryptedTokens, { ...target, grantId: authorizationId }, config, 'pending');
      const binding = { ...target, grantId };
      tx.set(grant, {
        ...binding, ...uploadConfigIdentity(config), accessExpiresAt: review.accessExpiresAt,
        encryptedTokens: encryptUploadTokens(tokens, binding, config, 'grant'),
      });
      tx.delete(pending);
    });
    return noStoreJson({ ok: true });
  });
}

async function finishUploadCallback(request: Request, url: URL, state: string, db: ReturnType<typeof adminDb>, deps: YouTubeUploadDependencies, onVerified: () => void) {
  const stateRef = uploadStateRef(db, state);
  const actor = await db.runTransaction(async tx => {
    const parsed = stateSchema.safeParse((await tx.get(stateRef)).data());
    if (!parsed.success) throw youtubeUploadNeedsPermission();
    verifyOAuthBrowserState(request, 'youtube', parsed.data.browserSecretDigest);
    tx.delete(stateRef);
    return parsed.data;
  });
  onVerified();
  if (url.searchParams.has('error')) throw youtubeUploadNeedsPermission();
  const code = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/).parse(url.searchParams.get('code'));
  const now = deps.now ?? Date.now;
  const { workspaceId, businessId, ownerUid, channelId, connectionRevision } = actor;
  const target = { workspaceId, businessId, ownerUid, channelId, connectionRevision };
  const ref = db.collection('workspaces').doc(workspaceId);
  const { guard, pending } = youtubeUploadRefs(ref, businessId);
  const recheck = async (tx: Tx) => {
    await requireYouTubeUploadBusiness(tx, ref, ownerUid, businessId);
    const config = youtubeConfigForWorkspace(workspaceId, deps.env);
    if (!config || actor.redirectUri !== config.redirectUri || !matchesUploadConfig(actor, config)) throw youtubeUploadNeedsPermission();
    const saved = await readYouTubeUploadConnection(tx, ref, businessId);
    requireYouTubeUploadTarget(saved, target, config);
    if (await readGeneration(tx, guard) !== actor.generation || actor.expiresAt <= now()) throw youtubeUploadNeedsPermission();
    return config;
  };

  const config = await db.runTransaction(recheck);
  const grant = await exchangeYouTubeUploadGrant(config, code, actor.verifier, channelId, { fetcher: deps.fetcher, now, signal: request.signal });
  const authorizationId = identifier();
  const encryptedTokens = encryptUploadTokens(grant.tokens, { ...target, grantId: authorizationId }, config, 'pending');
  await db.runTransaction(async tx => {
    await recheck(tx);
    const issuedAt = now();
    if (grant.accessExpiresAt <= issuedAt) throw youtubeUploadNeedsPermission();
    const expiresAt = issuedAt + ttlMs;
    tx.set(pending, {
      ...target, ...uploadConfigIdentity(config), generation: actor.generation, authorizationId, encryptedTokens,
      accessExpiresAt: grant.accessExpiresAt, expiresAt, deleteAt: new Date(expiresAt),
    });
  });
}

function uploadCallbackResponse(redirect: Pick<YouTubeConfig, 'origin'>, status: 'authorized' | 'failed', verifiedState?: string) {
  const response = NextResponse.redirect(new URL(`/?youtube_upload=${status}`, redirect.origin), 303);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return verifiedState ? clearOAuthBrowserState(response, 'youtube', verifiedState) : response;
}

export async function dispatchYouTubeCallback(request: Request, deps: YouTubeUploadDependencies = {}) {
  const url = new URL(request.url);
  const states = url.searchParams.getAll('state');
  const redirect = youtubeRedirect(deps.env);
  if (!redirect || (url.pathname !== YOUTUBE_CALLBACK_PATH && url.pathname !== `${YOUTUBE_CALLBACK_PATH}/`) ||
    states.length !== 1 || !nonce.safeParse(states[0]).success) return youtubeCallback(request, deps);
  const state = states[0];
  let verified: string | undefined;
  try {
    const db = deps.database ?? adminDb();
    // Hanya membaca untuk menentukan alur. Bukti browser dan konsumsi state tetap satu transaksi.
    if (!(await uploadStateRef(db, state).get()).exists) return youtubeCallback(request, { ...deps, database: db });
    if (url.searchParams.getAll('code').length > 1) return uploadCallbackResponse(redirect, 'failed');
    await finishUploadCallback(request, url, state, db, deps, () => { verified = state; });
    return uploadCallbackResponse(redirect, 'authorized', verified);
  } catch { return uploadCallbackResponse(redirect, 'failed', verified); }
}
