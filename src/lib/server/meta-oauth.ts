import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from './firebase';
import { requireWorkspace } from './auth';
import { encryptMetaToken } from './meta-crypto';
import { graphRequest, graphVersion, type MetaConnection } from './meta-graph';
import { discoverMetaPages } from './meta-pages';
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

export async function beginMetaOAuth(request: Request, workspaceId: unknown) {
  const { user, ref } = await requireWorkspace(request, workspaceId, true);
  const config = metaConfig();
  encryptMetaToken('configuration-check', ref.id); // Fail before redirect if encryption is unavailable.
  const state = randomBytes(32).toString('base64url');
  await adminDb().collection('_meta_oauth_states').doc(oauthStateHash(state)).create({ uid: user.uid, workspaceId: ref.id, expiresAt: Date.now() + 10 * 60_000 });
  const authorize = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
  authorize.search = new URLSearchParams({ client_id: config.appId, redirect_uri: config.redirectUri, response_type: 'code', scope: META_SCOPES.join(','), state, auth_type: 'rerequest' }).toString();
  return { url: authorize.toString() };
}

export async function finishMetaOAuth(url: URL) {
  const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get('state'));
  const config = metaConfig();
  const db = adminDb();
  const stateRef = db.collection('_meta_oauth_states').doc(oauthStateHash(state));
  const actor = await db.runTransaction(async tx => {
    const snap = await tx.get(stateRef);
    const data = snap.data();
    if (!data || data.expiresAt < Date.now()) throw new ApiError(400, 'Sesi koneksi berakhir. Mulai kembali dari Veloxa.');
    tx.delete(stateRef);
    return data as { uid: string; workspaceId: string };
  });
  if (url.searchParams.has('error')) throw new ApiError(400, 'Izin Meta belum diberikan.');
  const code = z.string().min(1).max(4096).parse(url.searchParams.get('code'));
  const workspaceRef = db.collection('workspaces').doc(actor.workspaceId);
  const workspace = (await workspaceRef.get()).data();
  if (!workspace || workspace.ownerUid !== actor.uid) throw new ApiError(403, 'Pemilik workspace berubah. Mulai koneksi kembali.');
  const short = await graphRequest<{ access_token?: string }>('oauth/access_token', '', 'GET', { client_id: config.appId, client_secret: config.appSecret, redirect_uri: config.redirectUri, code });
  if (!short.access_token) throw new ApiError(502, 'Meta tidak memberikan token login.');
  const long = await graphRequest<{ access_token?: string; expires_in?: number }>('oauth/access_token', '', 'GET', { grant_type: 'fb_exchange_token', client_id: config.appId, client_secret: config.appSecret, fb_exchange_token: short.access_token });
  if (!long.access_token) throw new ApiError(502, 'Meta tidak memberikan token jangka panjang.');
  const token = long.access_token;
  const debug = await graphRequest<{ data?: { is_valid?: boolean; app_id?: string; expires_at?: number; data_access_expires_at?: number; granular_scopes?: { scope: string; target_ids?: string[] }[] } }>('debug_token', `${config.appId}|${config.appSecret}`, 'GET', { input_token: token });
  if (!debug.data?.is_valid || String(debug.data.app_id) !== config.appId) throw new ApiError(400, 'Token Meta tidak sesuai dengan aplikasi Veloxa.');
  if (typeof debug.data.expires_at !== 'number' || typeof debug.data.data_access_expires_at !== 'number') throw new ApiError(502, 'Masa berlaku token Meta belum dapat diverifikasi.');
  const limits = [debug.data.expires_at, debug.data.data_access_expires_at].filter((value): value is number => typeof value === 'number' && value > 0);
  if (long.expires_in && long.expires_in > 0) limits.push(Math.floor(Date.now() / 1000) + long.expires_in);
  const expiresAt = limits.length ? Math.min(...limits) * 1000 : 0;
  if (expiresAt && expiresAt <= Date.now()) throw new ApiError(400, 'Token Meta telah berakhir.');
  const permissions = await graphRequest<{ data: { permission: string; status: string }[] }>('me/permissions', token);
  const scopes = permissions.data.filter(p => p.status === 'granted').map(p => p.permission);
  if (META_SCOPES.some(scope => !scopes.includes(scope))) throw new ApiError(400, 'Berikan seluruh izin Page dan publikasi Instagram saat menghubungkan ulang.');
  const selectedIds = (debug.data.granular_scopes || []).filter(grant => grant.scope === 'pages_manage_posts').flatMap(grant => grant.target_ids || []);
  const pages = await discoverMetaPages(token, selectedIds);
  const previous = await workspaceRef.collection('meta_authorizations').get();
  const batch = db.batch();
  for (const old of previous.docs) if (!pages.some(page => page.id === old.id)) batch.delete(old.ref);
  for (const page of pages) {
    batch.set(workspaceRef.collection('meta_authorizations').doc(page.id), {
      pageId: page.id, pageName: page.name.slice(0, 160), instagramId: page.instagram_business_account?.id || '',
      instagramHandle: page.instagram_business_account?.username || '',
      encryptedToken: encryptMetaToken(page.access_token!, actor.workspaceId), expiresAt, scopes, authorizedBy: actor.uid, authorizedAt: Date.now(),
    });
  }
  await batch.commit();
  return { origin: config.origin, workspaceId: actor.workspaceId };
}

export function publicConnection(connection: MetaConnection): ChannelConnectionState {
  return { channel: connection.channel, connected: !connection.expiresAt || connection.expiresAt > Date.now(), handle: connection.handle, accountName: connection.accountName,
    followerCount: 0, oauthMode: connection.expiresAt && connection.expiresAt <= Date.now() ? 'pending_review' : 'direct_publish', tokenExpiresAt: connection.expiresAt ? new Date(connection.expiresAt).toISOString() : null, lastPublishedAt: connection.lastPublishedAt || null };
}

export async function metaAccounts(request: Request, workspaceId: unknown) {
  const { ref } = await requireWorkspace(request, workspaceId, true);
  const [pages, connections] = await Promise.all([ref.collection('meta_authorizations').get(), ref.collection('private_meta_connections').get()]);
  return {
    pages: pages.docs.filter(doc => !doc.data().expiresAt || doc.data().expiresAt > Date.now()).map(doc => ({ pageId: doc.id, pageName: doc.data().pageName, instagramHandle: doc.data().instagramHandle })),
    connections: connections.docs.map(doc => publicConnection(doc.data() as MetaConnection)),
  };
}

export async function selectMetaPage(request: Request, workspaceId: unknown, pageId: unknown) {
  const { ref, user } = await requireWorkspace(request, workspaceId, true);
  const id = z.string().regex(/^\d+$/).parse(pageId);
  const authorized = (await ref.collection('meta_authorizations').doc(id).get()).data();
  if (!authorized || authorized.authorizedBy !== user.uid || (authorized.expiresAt && authorized.expiresAt <= Date.now())) throw new ApiError(409, 'Berikan izin Meta untuk Page ini terlebih dahulu.', 'reconnect_required');
  const connections: MetaConnection[] = [{ channel: 'facebook', accountId: id, pageId: id, accountName: authorized.pageName, handle: id, encryptedToken: authorized.encryptedToken, expiresAt: authorized.expiresAt }];
  if (authorized.instagramId) connections.push({ ...connections[0], channel: 'instagram', accountId: authorized.instagramId, accountName: authorized.instagramHandle, handle: '@' + authorized.instagramHandle });
  const batch = adminDb().batch();
  // Selecting a Page replaces the pair atomically; it cannot leave an Instagram from another Page.
  if (!authorized.instagramId) {
    batch.delete(ref.collection('private_meta_connections').doc('instagram'));
    batch.delete(ref.collection('connections').doc('instagram'));
  }
  for (const connection of connections) {
    batch.set(ref.collection('private_meta_connections').doc(connection.channel), connection);
    batch.set(ref.collection('connections').doc(connection.channel), publicConnection(connection));
  }
  await batch.commit();
  return { connections: connections.map(publicConnection) };
}

export async function disconnectMeta(request: Request, workspaceId: unknown) {
  const { ref } = await requireWorkspace(request, workspaceId, true);
  const authorizations = await ref.collection('meta_authorizations').get();
  const batch = adminDb().batch();
  for (const channel of ['facebook', 'instagram']) {
    batch.delete(ref.collection('private_meta_connections').doc(channel));
    batch.delete(ref.collection('connections').doc(channel));
  }
  for (const doc of authorizations.docs) batch.delete(doc.ref);
  await batch.commit();
}
