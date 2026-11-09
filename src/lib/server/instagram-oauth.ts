import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from './firebase';
import { requireWorkspace, workspaceIdSchema } from './auth';
import { encryptMetaToken } from './meta-crypto';
import { graphRequest, MetaRequestError, type MetaConnection } from './meta-graph';
import { publicConnection } from './meta-oauth';
import { ApiError } from './http';
import { instagramLoginConfig, INSTAGRAM_LOGIN_SCOPES } from './instagram-config';

const stateDigest = (value: string) => createHash('sha256').update(value).digest('hex');
const numericId = z.string().regex(/^\d+$/).max(128);
const generationValue = (value: unknown) => value === undefined ? 0 : z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).parse(value);
const instagramAccount = z.object({ id: numericId, username: z.string().regex(/^[A-Za-z0-9_.]{1,30}$/) });
const providerError = () => new ApiError(502, 'Instagram belum dapat memverifikasi koneksi. Mulai kembali dan berikan izin yang diperlukan.', 'instagram_login_failed');
type Dependencies = { authorize?: typeof requireWorkspace; database?: ReturnType<typeof adminDb>; fetcher?: typeof fetch; encrypt?: typeof encryptMetaToken; now?: () => number };

export function buildInstagramAuthorizeUrl(state: string) {
  const config = instagramLoginConfig();
  const url = new URL('https://www.facebook.com/dialog/oauth');
  // prompt=login always exposes the Instagram choice, including an existing Facebook session.
  url.search = new URLSearchParams({ client_id: config.appId, config_id: config.configId, redirect_uri: config.redirectUri, response_type: 'code', display: 'popup', override_default_response_type: 'true', prompt: 'login', state }).toString();
  return url.toString();
}

export async function exchangeInstagramLogin(code: string, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  const config = instagramLoginConfig();
  let stage = 'exchange';
  try {
    const response = z.object({ ['access_token']: z.string().min(1), expires_in: z.number().int().nonnegative().optional() }).parse(await graphRequest<unknown>('oauth/access_token', '', 'POST', { client_id: config.appId, ['client_secret']: config.appCredential, code, redirect_uri: config.redirectUri }, fetcher));
    const credential = response.access_token;
    stage = 'proof';
    const proof = z.object({ data: z.object({ is_valid: z.literal(true), app_id: numericId, scopes: z.array(z.string()), expires_at: z.number().int().nonnegative(), data_access_expires_at: z.number().int().nonnegative().optional() }) }).parse(await graphRequest<unknown>('debug_token', `${config.appId}|${config.appCredential}`, 'GET', { ['input_token']: credential }, fetcher));
    if (proof.data.app_id !== config.appId || INSTAGRAM_LOGIN_SCOPES.some(scope => !proof.data.scopes.includes(scope))) throw new Error('Invalid app or permissions');
    stage = 'business';
    const business = z.object({ client_business_id: numericId }).parse(await graphRequest<unknown>('me', credential, 'GET', { fields: 'client_business_id' }, fetcher));
    stage = 'accounts';
    const accounts: Array<z.infer<typeof instagramAccount>> = []; const cursors = new Set<string>(); let after = '';
    for (let page = 0; page < 10; page++) {
      const result = z.object({ data: z.array(instagramAccount).max(50), paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().max(4096).optional() }).optional() }).optional() }).parse(await graphRequest<unknown>('me/assigned_instagram_accounts', credential, 'GET', { fields: 'id,username', limit: '50', ...(after ? { after } : {}) }, fetcher));
      accounts.push(...result.data);
      if (!result.paging?.next) break;
      after = result.paging.cursors?.after || '';
      if (!after || cursors.has(after) || page === 9) throw new Error('Invalid account pagination');
      cursors.add(after);
    }
    if (!accounts.length || new Set(accounts.map(account => account.id)).size !== accounts.length) throw new Error('No unique Instagram accounts');
    const expirations = [proof.data.expires_at, proof.data.data_access_expires_at || 0].filter(value => value > 0).map(value => value * 1000);
    // SUAT Never can report zero expiry; is_valid and absolute proof expiry remain authoritative.
    if (response.expires_in !== undefined && response.expires_in > 0) expirations.push(now() + response.expires_in * 1000);
    const expiresAt = expirations.length ? Math.min(...expirations) : 0;
    if (expiresAt && (!Number.isSafeInteger(expiresAt) || expiresAt <= now())) throw new Error('Expired authorization');
    return { credential, clientBusinessId: business.client_business_id, accounts, expiresAt };
  } catch (error) { console.warn('veloxa_instagram_login_failed', { stage, providerCode: error instanceof MetaRequestError ? error.providerCode : undefined, reason: error instanceof z.ZodError ? 'invalid_shape' : 'provider_rejected' }); throw providerError(); }
}

export async function beginInstagramOAuth(request: Request, workspaceId: unknown, deps: Dependencies = {}) {
  const { user, ref } = await (deps.authorize || requireWorkspace)(request, workspaceId, true);
  const config = instagramLoginConfig();
  (deps.encrypt || encryptMetaToken)('configuration-check', ref.id);
  const generation = generationValue((await ref.collection('integration_guards').doc('instagram').get()).data()?.generation);
  const state = randomBytes(32).toString('base64url');
  await (deps.database || adminDb()).collection('_instagram_oauth_states').doc(stateDigest(state)).create({ uid: user.uid, workspaceId: ref.id, generation, configId: config.configId, appId: config.appId, redirectUri: config.redirectUri, expiresAt: (deps.now || Date.now)() + 10 * 60_000 });
  return { url: buildInstagramAuthorizeUrl(state) };
}

export async function finishInstagramOAuth(url: URL, deps: Dependencies = {}) {
  const config = instagramLoginConfig();
  // Firebase rewrites the incoming origin to Cloud Run. Never use that origin for redirects;
  // the configured redirect URI, one-time state, and verified app/owner are the trust boundary.
  if (!['/api/veloxa/instagram/callback', '/api/veloxa/instagram/callback/'].includes(url.pathname)) throw new ApiError(400, 'Callback Instagram tidak valid.');
  const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get('state'));
  const db = deps.database || adminDb(); const now = deps.now || Date.now;
  const stateRef = db.collection('_instagram_oauth_states').doc(stateDigest(state));
  const actor = await db.runTransaction(async tx => {
    const value = (await tx.get(stateRef)).data();
    const result = z.object({ uid: z.string().min(1).max(128), workspaceId: workspaceIdSchema, generation: z.number().int().nonnegative(), redirectUri: z.string().url().max(2048), configId: numericId, appId: numericId, expiresAt: z.number().finite() }).safeParse(value);
    if (!result.success || result.data.expiresAt <= now() || result.data.configId !== config.configId || result.data.appId !== config.appId || result.data.redirectUri !== config.redirectUri) throw new ApiError(400, 'Sesi koneksi Instagram berakhir. Mulai kembali dari Veloxa.');
    tx.delete(stateRef); return result.data;
  });
  if (url.searchParams.has('error')) throw new ApiError(400, 'Izin Instagram belum diberikan.');
  const code = z.string().min(1).max(4096).parse(url.searchParams.get('code'));
  const ref = db.collection('workspaces').doc(actor.workspaceId);
  if ((await ref.get()).data()?.ownerUid !== actor.uid) throw new ApiError(403, 'Pemilik workspace berubah. Mulai koneksi kembali.');
  const login = await exchangeInstagramLogin(code, deps.fetcher, now);
  const encrypted = (deps.encrypt || encryptMetaToken)(login.credential, actor.workspaceId);
  await db.runTransaction(async tx => {
    const workspace = (await tx.get(ref)).data();
    const generation = generationValue((await tx.get(ref.collection('integration_guards').doc('instagram'))).data()?.generation);
    const active = (await tx.get(ref.collection('private_meta_connections').doc('instagram'))).data() as MetaConnection | undefined;
    if (workspace?.ownerUid !== actor.uid) throw new ApiError(403, 'Pemilik workspace berubah. Mulai koneksi kembali.');
    if (generation !== actor.generation) throw new ApiError(409, 'Koneksi sudah dibatalkan. Mulai kembali dari Veloxa.', 'reconnect_required');
    // A new grant invalidates a selected Unified account no longer shared; separate Page login remains independent.
    if (active?.loginProvider === 'instagram_unified' && !login.accounts.some(account => account.id === active.accountId)) {
      tx.delete(ref.collection('private_meta_connections').doc('instagram'));
      tx.delete(ref.collection('connections').doc('instagram'));
    }
    // One private grant document avoids Firestore's 500-write limit when a business shares many accounts.
    tx.set(ref.collection('instagram_authorizations').doc('current'), { accounts: login.accounts, generation, clientBusinessId: login.clientBusinessId, configId: config.configId, ['encryptedToken']: encrypted, expiresAt: login.expiresAt, authorizedBy: actor.uid, authorizedAt: now() });
  });
  // The user selects an explicitly named Instagram account before replacing a current connection.
  return { origin: config.origin, workspaceId: actor.workspaceId };
}

export async function selectInstagramAccount(request: Request, workspaceId: unknown, accountId: unknown, deps: Dependencies = {}) {
  const { ref, user } = await (deps.authorize || requireWorkspace)(request, workspaceId, true);
  const config = instagramLoginConfig(); const id = numericId.parse(accountId); const now = deps.now || Date.now;
  return (deps.database || adminDb()).runTransaction(async tx => {
    const workspace = (await tx.get(ref)).data();
    const value = (await tx.get(ref.collection('instagram_authorizations').doc('current'))).data();
    const generation = generationValue((await tx.get(ref.collection('integration_guards').doc('instagram'))).data()?.generation);
    const account = value?.accounts?.find((candidate: { id: string; username: string }) => candidate.id === id);
    const facebook = (await tx.get(ref.collection('private_meta_connections').doc('facebook'))).data() as MetaConnection | undefined;
    if (workspace?.ownerUid !== user.uid || !value || !account || value.generation !== generation || value.authorizedBy !== user.uid || value.configId !== config.configId || (value.expiresAt && value.expiresAt <= now())) throw new ApiError(409, 'Berikan izin Instagram untuk akun ini terlebih dahulu.', 'reconnect_required');
    const connection: MetaConnection = { channel: 'instagram', loginProvider: 'instagram_unified', accountId: id, pageId: '', accountName: account.username, handle: '@' + account.username, ['encryptedToken']: value.encryptedToken, expiresAt: value.expiresAt, clientBusinessId: value.clientBusinessId, configId: value.configId };
    tx.set(ref.collection('private_meta_connections').doc('instagram'), connection);
    tx.set(ref.collection('connections').doc('instagram'), publicConnection(connection));
    return { connections: [...(facebook ? [publicConnection(facebook)] : []), publicConnection(connection)] };
  });
}

export async function disconnectInstagram(request: Request, workspaceId: unknown, deps: Dependencies = {}) {
  const { ref, user } = await (deps.authorize || requireWorkspace)(request, workspaceId, true);
  const db = deps.database || adminDb();
  await db.runTransaction(async tx => {
    const workspace = (await tx.get(ref)).data();
    const guard = ref.collection('integration_guards').doc('instagram');
    const generation = generationValue((await tx.get(guard)).data()?.generation);
    if (workspace?.ownerUid !== user.uid) throw new ApiError(403, 'Akses workspace telah berubah.');
    // Selection reads this guard and the deleted grant. Firestore retries any racing selection,
    // while the generation also invalidates OAuth callbacks that started before disconnect.
    tx.set(guard, { generation: generation + 1 });
    tx.delete(ref.collection('instagram_authorizations').doc('current'));
    tx.delete(ref.collection('private_meta_connections').doc('instagram'));
    tx.delete(ref.collection('connections').doc('instagram'));
  });
}
