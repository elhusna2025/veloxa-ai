import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from './firebase';
import { requireWorkspace } from './auth';
import { encryptMetaToken } from './meta-crypto';
import { graphRequest, graphVersion, type MetaConnection } from './meta-graph';
import { discoverMetaPages } from './meta-pages';
import { isInstagramLoginConfigured } from './instagram-config';
import { ApiError } from './http';
import type { ChannelConnectionState } from '../veloxa-types';

export const META_SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list', 'pages_manage_posts'];

export function metaConfig() {
  const appId = process.env.META_APP_ID || process.env.META_INSTAGRAM_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || process.env.META_INSTAGRAM_APP_SECRET || '';
  const redirectUri = process.env.META_REDIRECT_URI || process.env.META_INSTAGRAM_REDIRECT_URI || '';
  let url: URL;
  try { url = new URL(redirectUri); } catch { throw new ApiError(503, 'Callback HTTPS Meta belum dikonfigurasi.', 'meta_not_configured'); }
  if (url.protocol !== 'https:' || url.pathname !== '/api/veloxa/meta/callback' || url.search || url.hash || url.username || url.password || !/^\d+$/.test(appId) || !appSecret) {
    throw new ApiError(503, 'Konfigurasi aplikasi dan callback Meta belum lengkap.', 'meta_not_configured');
  }
  return { appId, appSecret, redirectUri, origin: url.origin };
}

export const oauthStateHash = (state: string) => createHash('sha256').update(state).digest('hex');

type OAuthDeps = { authorize?: typeof requireWorkspace; database?: ReturnType<typeof adminDb>; fetcher?: typeof fetch; encrypt?: typeof encryptMetaToken };
const readGeneration = (value: unknown) => value === undefined ? 0 : z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).parse(value);

export async function beginMetaOAuth(request: Request, workspaceId: unknown, deps: OAuthDeps = {}) {
  const { user, ref } = await (deps.authorize || requireWorkspace)(request, workspaceId, true);
  const config = metaConfig();
  (deps.encrypt || encryptMetaToken)('configuration-check', ref.id); // Fail before redirect if encryption is unavailable.
  const generation = readGeneration((await ref.collection('integration_guards').doc('meta').get()).data()?.generation);
  const configBinding = oauthStateHash(JSON.stringify([config.appId, config.redirectUri, META_SCOPES]));
  const state = randomBytes(32).toString('base64url');
  await (deps.database || adminDb()).collection('_meta_oauth_states').doc(oauthStateHash(state)).create({ uid: user.uid, workspaceId: ref.id, generation, configBinding, expiresAt: Date.now() + 10 * 60_000 });
  const authorize = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  authorize.search = new URLSearchParams({ client_id: config.appId, redirect_uri: config.redirectUri, response_type: 'code', scope: META_SCOPES.join(','), state, auth_type: 'rerequest' }).toString();
  return { url: authorize.toString() };
}

export async function finishMetaOAuth(url: URL, deps: OAuthDeps = {}) {
  const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get('state'));
  const config = metaConfig();
  // Firebase rewrites the incoming origin to Cloud Run. Never use that origin for redirects;
  // the configured redirect URI, one-time state, and verified app/owner are the trust boundary.
  if (!['/api/veloxa/meta/callback', '/api/veloxa/meta/callback/'].includes(url.pathname)) throw new ApiError(400, 'Callback Meta tidak valid.');
  const db = deps.database || adminDb();
  const stateRef = db.collection('_meta_oauth_states').doc(oauthStateHash(state));
  const actor = await db.runTransaction(async tx => {
    const snap = await tx.get(stateRef);
    const data = snap.data();
    if (!data || data.expiresAt < Date.now() || data.configBinding !== oauthStateHash(JSON.stringify([config.appId, config.redirectUri, META_SCOPES]))) throw new ApiError(400, 'Sesi koneksi berakhir. Mulai kembali dari Veloxa.');
    tx.delete(stateRef);
    return data as { uid: string; workspaceId: string; generation?: number };
  });
  if (url.searchParams.has('error')) throw new ApiError(400, 'Izin Meta belum diberikan.');
  const code = z.string().min(1).max(4096).parse(url.searchParams.get('code'));
  const workspaceRef = db.collection('workspaces').doc(actor.workspaceId);
  const workspace = (await workspaceRef.get()).data();
  if (!workspace || workspace.ownerUid !== actor.uid) throw new ApiError(403, 'Pemilik workspace berubah. Mulai koneksi kembali.');
  const metaGuard = workspaceRef.collection('integration_guards').doc('meta');
  if (readGeneration((await metaGuard.get()).data()?.generation) !== (actor.generation ?? 0)) throw new ApiError(409, 'Koneksi Meta telah dibatalkan. Mulai kembali.', 'reconnect_required');
  const short = await graphRequest<{ access_token?: string }>('oauth/access_token', '', 'POST', { client_id: config.appId, client_secret: config.appSecret, redirect_uri: config.redirectUri, code }, deps.fetcher);
  if (!short.access_token) throw new ApiError(502, 'Meta tidak memberikan token login.');
  const long = await graphRequest<{ access_token?: string; expires_in?: number }>('oauth/access_token', '', 'POST', { grant_type: 'fb_exchange_token', client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: short.access_token }, deps.fetcher);
  if (!long.access_token) throw new ApiError(502, 'Meta tidak memberikan token jangka panjang.');
  const token = long.access_token;
  const debug = await graphRequest<{ data?: { is_valid?: boolean; app_id?: string; expires_at?: number; data_access_expires_at?: number; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>('debug_token', `${config.appId}|${config.appSecret}`, 'GET', { input_token: token }, deps.fetcher);
  if (!debug.data?.is_valid || String(debug.data.app_id) !== config.appId) throw new ApiError(400, 'Token Meta tidak sesuai dengan aplikasi Veloxa.');
  if (typeof debug.data.expires_at !== 'number' || typeof debug.data.data_access_expires_at !== 'number') throw new ApiError(502, 'Masa berlaku token Meta belum dapat diverifikasi.');
  const limits = [debug.data.expires_at, debug.data.data_access_expires_at].filter((value): value is number => typeof value === 'number' && value > 0);
  if (long.expires_in && long.expires_in > 0) limits.push(Math.floor(Date.now() / 1000) + long.expires_in);
  const expiresAt = limits.length ? Math.min(...limits) * 1000 : 0;
  if (expiresAt && expiresAt <= Date.now()) throw new ApiError(400, 'Token Meta telah berakhir.');
  const permissions = await graphRequest<{ data: { permission: string; status: string }[] }>('me/permissions', token, 'GET', {}, deps.fetcher);
  const scopes = permissions.data.filter(p => p.status === 'granted').map(p => p.permission);
  if (META_SCOPES.some(scope => !scopes.includes(scope))) throw new ApiError(400, 'Berikan seluruh izin Page dan publikasi Instagram saat menghubungkan ulang.');
  const selectedIds = (debug.data.granular_scopes || []).filter(grant => grant.scope === 'pages_manage_posts').flatMap(grant => grant.target_ids || []);
  const pages = await discoverMetaPages(token, selectedIds, (path, values) => graphRequest(path, token, 'GET', values, deps.fetcher));
  await db.runTransaction(async tx => {
  const latestWorkspace = (await tx.get(workspaceRef)).data();
  const generation = readGeneration((await tx.get(metaGuard)).data()?.generation);
  const previous = await tx.get(workspaceRef.collection('meta_authorizations'));
  if (latestWorkspace?.ownerUid !== actor.uid || generation !== (actor.generation ?? 0)) throw new ApiError(409, 'Koneksi Meta telah dibatalkan atau pemilik workspace berubah. Mulai kembali.', 'reconnect_required');
  const batch = tx;
  for (const old of previous.docs) if (!pages.some(page => page.id === old.id)) batch.delete(old.ref);
  for (const page of pages) {
    batch.set(workspaceRef.collection('meta_authorizations').doc(page.id), {
      metaGeneration: generation, pageId: page.id, pageName: page.name.slice(0, 160), instagramId: page.instagram_business_account?.id || '',
      instagramHandle: page.instagram_business_account?.username || '',
      encryptedToken: (deps.encrypt || encryptMetaToken)(page.access_token!, actor.workspaceId), expiresAt, scopes, authorizedBy: actor.uid, authorizedAt: Date.now(),
    });
  }
  });
  return { origin: config.origin, workspaceId: actor.workspaceId };
}

export function publicConnection(connection: MetaConnection): ChannelConnectionState {
  return { channel: connection.channel, connected: !connection.expiresAt || connection.expiresAt > Date.now(), handle: connection.handle, accountName: connection.accountName,
    followerCount: 0, oauthMode: connection.expiresAt && connection.expiresAt <= Date.now() ? 'pending_review' : 'direct_publish', tokenExpiresAt: connection.expiresAt ? new Date(connection.expiresAt).toISOString() : null, lastPublishedAt: connection.lastPublishedAt || null };
}

export async function metaAccounts(request: Request, workspaceId: unknown) {
  const { ref, user } = await requireWorkspace(request, workspaceId, true);
  const [pages, connections, instagram] = await Promise.all([ref.collection('meta_authorizations').get(), ref.collection('private_meta_connections').get(), ref.collection('instagram_authorizations').doc('current').get()]);
  return {
    instagramLoginAvailable: isInstagramLoginConfigured(),
    instagramAccounts: instagram.data()?.authorizedBy === user.uid && (!instagram.data()?.expiresAt || instagram.data()!.expiresAt > Date.now()) ? (instagram.data()?.accounts || []).map((account: { id: string; username: string }) => ({ accountId: account.id, username: account.username })) : [],
    pages: pages.docs.filter(doc => !doc.data().expiresAt || doc.data().expiresAt > Date.now()).map(doc => ({ pageId: doc.id, pageName: doc.data().pageName, instagramHandle: doc.data().instagramHandle })),
    connections: connections.docs.map(doc => publicConnection(doc.data() as MetaConnection)),
  };
}

export async function selectMetaPage(request: Request, workspaceId: unknown, pageId: unknown, deps: { authorize?: typeof requireWorkspace; database?: ReturnType<typeof adminDb> } = {}) {
  const { ref, user } = await (deps.authorize || requireWorkspace)(request, workspaceId, true);
  const id = z.string().regex(/^\d+$/).parse(pageId);
  const db = deps.database || adminDb();
  return db.runTransaction(async tx => {
    const workspace = (await tx.get(ref)).data();
    const generation = readGeneration((await tx.get(ref.collection('integration_guards').doc('meta'))).data()?.generation);
    const authorized = (await tx.get(ref.collection('meta_authorizations').doc(id))).data();
    const existingInstagram = (await tx.get(ref.collection('private_meta_connections').doc('instagram'))).data() as MetaConnection | undefined;
    if (workspace?.ownerUid !== user.uid || !authorized || authorized.authorizedBy !== user.uid || (authorized.metaGeneration ?? 0) !== generation || (authorized.expiresAt && authorized.expiresAt <= Date.now())) throw new ApiError(409, 'Berikan izin Meta untuk Page ini terlebih dahulu.', 'reconnect_required');
  const connections: MetaConnection[] = [{ channel: 'facebook', accountId: id, pageId: id, accountName: authorized.pageName, handle: id, encryptedToken: authorized.encryptedToken, expiresAt: authorized.expiresAt }];
  if (authorized.instagramId) connections.push({ ...connections[0], channel: 'instagram', accountId: authorized.instagramId, accountName: authorized.instagramHandle, handle: '@' + authorized.instagramHandle });
  const independentInstagram = existingInstagram?.loginProvider === 'instagram' || existingInstagram?.loginProvider === 'instagram_unified' ? existingInstagram : undefined;
  if (!authorized.instagramId && independentInstagram) connections.push(independentInstagram);
  // The Page authorization is deleted in the same global disconnect transaction, so racing selection retries.
  // Facebook-only Pages preserve independent Instagram; stale Page-linked pairs are removed.
  if (!authorized.instagramId && !independentInstagram) {
    tx.delete(ref.collection('private_meta_connections').doc('instagram'));
    tx.delete(ref.collection('connections').doc('instagram'));
  }
  for (const connection of connections) {
    tx.set(ref.collection('private_meta_connections').doc(connection.channel), connection);
    tx.set(ref.collection('connections').doc(connection.channel), publicConnection(connection));
  }
  return { connections: connections.map(publicConnection) };
  });
}

export async function disconnectMeta(request: Request, workspaceId: unknown, deps: { authorize?: typeof requireWorkspace; database?: ReturnType<typeof adminDb> } = {}) {
  const { ref, user } = await (deps.authorize || requireWorkspace)(request, workspaceId, true);
  await (deps.database || adminDb()).runTransaction(async tx => {
    const workspace = (await tx.get(ref)).data();
    const guard = ref.collection('integration_guards').doc('instagram');
    const generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).parse((await tx.get(guard)).data()?.generation ?? 0);
    const metaGuard = ref.collection('integration_guards').doc('meta');
    const metaGeneration = readGeneration((await tx.get(metaGuard)).data()?.generation);
    const authorizations = await tx.get(ref.collection('meta_authorizations'));
    if (workspace?.ownerUid !== user.uid) throw new ApiError(403, 'Akses workspace telah berubah.');
    // Seven writes revoke both connections and the independent grant. Refuse an oversized
    // transaction before any mutation rather than leaving a partially disconnected pair.
    if (authorizations.docs.length > 493) throw new ApiError(409, 'Terlalu banyak otorisasi untuk diputus sekaligus. Hubungi administrator.');
    tx.set(guard, { generation: generation + 1 });
    tx.set(metaGuard, { generation: metaGeneration + 1 });
    tx.delete(ref.collection('instagram_authorizations').doc('current'));
    for (const channel of ['facebook', 'instagram']) {
      tx.delete(ref.collection('private_meta_connections').doc(channel));
      tx.delete(ref.collection('connections').doc(channel));
    }
    for (const doc of authorizations.docs) tx.delete(doc.ref);
  });
}
