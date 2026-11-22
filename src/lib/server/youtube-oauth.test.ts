import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { blankBusinessProfile } from '../business-context';
import { ApiError } from './http';
import { YOUTUBE_READONLY_SCOPE } from './youtube-config';
import { decryptYouTubeTokens } from './youtube-crypto';
import { verifyOAuthBrowserState } from './oauth-browser-state';
import { startYouTube, youtubeCallback, youtubeAccounts, selectYouTubeConnection, disconnectYouTube } from './youtube-oauth';

const workspaceId = 'workspace-test';
const secondary = 'b_12345678-1234-4234-8234-123456789abc';
const missing = 'b_00000000-0000-4000-8000-000000000000';
const owner = 'test-owner';
const member = 'test-member';
const origin = 'https://veloxa.example.test';
const callbackPath = '/api/veloxa/youtube/callback';
const channelA = 'UC' + 'A'.repeat(22);
const channelB = 'UC' + 'B'.repeat(22);
const access = 'fixture-access';
const refresh = 'fixture-refresh';
const secret = 'fixture-client-secret';
const key = Buffer.alloc(32, 7);
const code = 'fixture-code';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

type Row = Record<string, unknown>;
class Doc {
  constructor(readonly firestore: Store, readonly path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return this.firestore.collection(`${this.path}/${name}`); }
  async get() { return { id: this.id, data: () => structuredClone(this.firestore.rows.get(this.path)) }; }
}
class Collection {
  constructor(readonly db: Store, readonly path: string, readonly filter: (row: Row) => boolean = () => true) {}
  doc(id: string) { return new Doc(this.db, `${this.path}/${id}`); }
  where(field: string, op: string, value: unknown) {
    assert.equal(op, '==');
    return new Collection(this.db, this.path, row => row[field] === value);
  }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.db.rows].filter(([path, row]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && this.filter(row));
    return { docs: await Promise.all(docs.map(([path]) => new Doc(this.db, path).get())) };
  }
}
class Store {
  rows = new Map<string, Row>();
  writeCount = 0;
  private queue: Promise<unknown> = Promise.resolve();
  collection(path: string) { return new Collection(this, path); }
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const writes: Array<() => void> = [];
      const result = await fn({
        get: (target: Doc | Collection) => { assert.equal(writes.length, 0, 'semua pembacaan harus mendahului penulisan'); return target.get(); },
        create: (ref: Doc, row: Row) => writes.push(() => { assert.equal(this.rows.has(ref.path), false); this.rows.set(ref.path, structuredClone(row)); }),
        set: (ref: Doc, row: Row) => writes.push(() => this.rows.set(ref.path, structuredClone(row))),
        delete: (ref: Doc) => writes.push(() => this.rows.delete(ref.path)),
      });
      for (const write of writes) write();
      this.writeCount += writes.length;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

function fixture() {
  const db = new Store();
  const ref = db.collection('workspaces').doc(workspaceId);
  const pending = (id = 'primary') => `${ref.path}/private_youtube_authorizations/${id}`;
  const connection = (id = 'primary') => `${ref.path}/private_youtube_connections/${id}`;
  const guard = (id = 'primary') => `${ref.path}/integration_guards/youtube_${id}`;
  const meta = `${ref.path}/private_meta_connections/instagram_123`;
  const workspace = { ownerUid: owner, memberUids: [member], snapshotJson: JSON.stringify({ brand: blankBusinessProfile(workspaceId, 'primary', 'Bisnis utama') }) };
  db.rows.set(ref.path, workspace);
  db.rows.set(`${ref.path}/business_contexts/${secondary}`, { revision: 1, brand: blankBusinessProfile(workspaceId, secondary, 'Bisnis kedua') });
  db.rows.set(meta, { accountId: '123' });
  const env: Record<string, string | undefined> = {
    YOUTUBE_OAUTH_ENABLED: 'true', YOUTUBE_CLIENT_ID: 'fixture-client', YOUTUBE_CLIENT_SECRET: secret,
    YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS: workspaceId,
    YOUTUBE_REDIRECT_URI: origin + callbackPath, YOUTUBE_TOKEN_ENCRYPTION_KEY: key.toString('base64'),
  };
  const options = { time: 1_000_000, uid: owner, channel: channelA, offline: true, beforeDiscovery: async () => {} };
  const calls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: access, refresh_token: options.offline ? refresh : undefined, expires_in: 3600, scope: YOUTUBE_READONLY_SCOPE, token_type: 'Bearer' });
    assert.equal(url.hostname, 'www.googleapis.com');
    await options.beforeDiscovery();
    return Response.json({ items: [{ id: options.channel, snippet: { title: 'Kanal uji', customUrl: '@contoh' } }] });
  };
  const authorize = async (_request: Request, raw: unknown) => {
    if (raw !== workspaceId) throw new ApiError(403, 'Workspace tidak tersedia.', 'forbidden');
    return { ref, user: { uid: options.uid }, workspaceId, workspace };
  };
  const deps = { authorize: authorize as never, database: db as never, now: () => options.time, fetcher, env };
  const request = (body: Row, method = 'POST') => new Request(`${origin}/api/veloxa/youtube`, { method, body: JSON.stringify(body) });
  const input = (businessId = 'primary') => ({ workspaceId, businessId });
  const start = (id = 'primary', startRevision = 0) => startYouTube(request({ ...input(id), startRevision }), deps);
  const accounts = (id = 'primary') => youtubeAccounts(new Request(`${origin}/api/veloxa/youtube/accounts?${new URLSearchParams(input(id))}`), deps);
  const save = (authorizationId: string, channelId: string, id = 'primary') => selectYouTubeConnection(request({ ...input(id), authorizationId, channelId }), deps);
  const disconnect = (channelId: string, revision: string, id = 'primary') => disconnectYouTube(request({ ...input(id), channelId, revision }, 'DELETE'), deps);
  async function begin(id = 'primary', startRevision?: number) {
    const response = await start(id, startRevision ?? (await (await accounts(id)).json()).startRevision);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const publicBody = await response.json();
    assert.deepEqual(Object.keys(publicBody).sort(), ['ok', 'url']);
    const authorizeUrl = new URL(publicBody.url);
    const state = authorizeUrl.searchParams.get('state')!;
    const url = new URL(`${callbackPath}/`, 'http://127.0.0.1:8080');
    url.search = new URLSearchParams({ state, code }).toString();
    return {
      authorizeUrl, state, url, cookie,
      finish: (headers: HeadersInit = { cookie }) => youtubeCallback(new Request(url, { headers }), deps),
    };
  }
  async function consent(id = 'primary') {
    assertRedirect(await (await begin(id)).finish(), 'authorized');
    return (await (await accounts(id)).json()).authorizationId as string;
  }
  return { db, ref, workspace, meta, deps, options, env, input, request, start, accounts, save, disconnect, begin, consent, pending, connection, guard, calls };
}

function assertRedirect(response: Response, result: 'authorized' | 'failed', expectedOrigin = origin) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${expectedOrigin}/?youtube=${result}`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
}

async function assertError(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  if (code) assert.equal(JSON.parse(body).code, code);
  for (const value of [secret, access, refresh, 'encryptedTokens', 'verifier']) assert.equal(body.includes(value), false);
}

test('Start membatasi scope, mengikat PKCE dan state hash, serta menolak callback tanpa cookie atau replay', async () => {
  const f = fixture();
  const attempt = await f.begin();
  const { authorizeUrl: url, state, cookie } = attempt;
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), YOUTUBE_READONLY_SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'select_account consent');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), origin + callbackPath);
  assert.equal(url.href.includes(secret), false);
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  const [cookieName, browserSecret] = cookie.split('=');
  assert.equal(cookieName, `__Host-veloxa_youtube_oauth_${digest(state)}`);
  assert.match(browserSecret, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(browserSecret, state);
  assert.equal(url.href.includes(browserSecret), false);
  const path = `_youtube_oauth_states/${digest(state)}`;
  const stored = f.db.rows.get(path)!;
  assert.equal(stored.expiresAt, f.options.time + 600_000);
  assert.equal(stored.uid, owner);
  assert.equal(stored.workspaceId, workspaceId);
  assert.equal(stored.businessId, 'primary');
  assert.equal(stored.browserSecretDigest, digest(browserSecret));
  assert.equal(JSON.stringify(stored).includes(browserSecret), false);
  assert.equal(JSON.stringify(stored).includes(state), false);
  const verifier = String(stored.verifier);
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  const originalFetch = f.deps.fetcher;
  f.deps.fetcher = async (input, init) => {
    if (new URL(String(input)).hostname === 'oauth2.googleapis.com') {
      assert.ok(init?.body instanceof URLSearchParams);
      assert.equal(init.body.get('code_verifier'), verifier);
    }
    return originalFetch(input, init);
  };
  assertRedirect(await attempt.finish({}), 'failed');
  assert.equal(f.calls.length, 0);
  const response = await attempt.finish({ cookie, 'x-forwarded-host': 'ignored.example.test' });
  assertRedirect(response, 'authorized');
  assert.match(response.headers.get('set-cookie')!, /__Host-veloxa_youtube_oauth_[a-f0-9]{64}=;.*Max-Age=0/);
  assert.equal(f.db.rows.has(path), false);
  assertRedirect(await attempt.finish(), 'failed');
  assert.equal(f.calls.length, 2);
});

test('TTL Firestore mengikuti kedaluwarsa state OAuth dan otorisasi tertunda', async () => {
  const f = fixture();
  const attempt = await f.begin();
  const state = f.db.rows.get(`_youtube_oauth_states/${digest(attempt.state)}`)!;
  assert.equal(state.expiresAt, f.options.time + 600_000);
  assert.ok(state.deleteAt instanceof Date);
  assert.equal(state.deleteAt.getTime(), state.expiresAt);

  f.options.time += 30_000;
  assertRedirect(await attempt.finish(), 'authorized');
  const pending = f.db.rows.get(f.pending())!;
  assert.equal(pending.expiresAt, f.options.time + 600_000);
  assert.ok(pending.deleteAt instanceof Date);
  assert.equal(pending.deleteAt.getTime(), pending.expiresAt);

  const view = await (await f.accounts()).json();
  assert.equal((await f.save(view.authorizationId, channelA)).status, 200);
  assert.equal('deleteAt' in f.db.rows.get(f.connection())!, false);
});

test('Known authorize state cannot forge browser proof or consume legitimate state', async () => {
  const f = fixture();
  const attempt = await f.begin();
  const name = attempt.cookie.split('=')[0];
  const statePath = `_youtube_oauth_states/${digest(attempt.state)}`;
  const before = structuredClone(f.db.rows);
  const writes = f.db.writeCount;
  for (const value of [digest(attempt.state), attempt.state, Buffer.alloc(32, 9).toString('base64url')]) {
    const response = await attempt.finish({ cookie: `${name}=${value}` });
    assertRedirect(response, 'failed');
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.db.rows, before);
    assert.equal(f.db.writeCount, writes);
    assert.equal(f.db.rows.has(statePath), true);
  }
  assertRedirect(await attempt.finish(), 'authorized');
  assert.equal(f.db.rows.has(statePath), false);
});

test('Start lama yang tertunda sebelum transaksi tidak membatalkan OAuth dari pemulihan', async () => {
  const f = fixture();
  const initial = await (await f.accounts()).json();
  assert.equal(initial.startRevision, 0);
  assert.deepEqual(initial.channels, []);

  let entered!: () => void;
  let release!: () => void;
  const inFlight = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const runTransaction = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = async fn => {
    f.db.runTransaction = runTransaction;
    entered();
    await resume;
    return runTransaction(fn);
  };
  const delayed = f.start('primary', initial.startRevision);
  await Promise.race([
    inFlight,
    delayed.then(response => assert.fail('Start lama selesai sebelum transaksi: ' + response.status)),
  ]);

  const recovered = await (await f.accounts()).json();
  assert.equal(recovered.startRevision, 0);
  const current = await f.begin('primary', recovered.startRevision);
  assert.equal((await (await f.accounts()).json()).startRevision, 1);
  const other = await (await f.accounts(secondary)).json();
  assert.equal(other.startRevision, 0);
  const otherAttempt = await f.begin(secondary, other.startRevision);
  const before = structuredClone(f.db.rows);
  const writes = f.db.writeCount;

  release();
  const response = await delayed;
  assert.equal(response.headers.has('set-cookie'), false);
  await assertError(response, 409, 'youtube_start_conflict');
  assert.deepEqual(f.db.rows, before);
  assert.equal(f.db.writeCount, writes);

  assertRedirect(await current.finish(), 'authorized');
  assertRedirect(await otherAttempt.finish(), 'authorized');
  for (const businessId of ['primary', secondary]) {
    const view = await (await f.accounts(businessId)).json();
    assert.equal(view.startRevision, 1);
    assert.equal(view.channels[0]?.channelId, channelA);
  }
});

test('Start membutuhkan revisi bilangan bulat aman dan menolak input invalid tanpa penulisan', async () => {
  const f = fixture();
  const before = structuredClone(f.db.rows);
  const writes = f.db.writeCount;
  for (const startRevision of [undefined, null, '0', -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const response = await startYouTube(f.request({ ...f.input(), startRevision }), f.deps);
    assert.equal(response.headers.has('set-cookie'), false);
    await assertError(response, 400, 'invalid_request');
  }
  assert.deepEqual(f.db.rows, before);
  assert.equal(f.db.writeCount, writes);
});

test('Callback A finishing after start B never clears B for the same or another business', async () => {
  for (const businessB of ['primary', secondary]) {
    const f = fixture();
    const attemptA = await f.begin();
    let entered!: () => void;
    let release!: () => void;
    const inFlight = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    f.options.beforeDiscovery = async () => { entered(); await resume; };
    const finishingA = attemptA.finish();
    await inFlight;
    const attemptB = await f.begin(businessB);
    const jar = new Map([attemptA.cookie, attemptB.cookie].map(value => value.split('=') as [string, string]));
    f.options.beforeDiscovery = async () => {};
    release();
    const responseA = await finishingA;
    assertRedirect(responseA, businessB === 'primary' ? 'failed' : 'authorized');
    const cleared = responseA.headers.get('set-cookie')!;
    assert.equal(cleared.split('=')[0], attemptA.cookie.split('=')[0]);
    assert.notEqual(cleared.split('=')[0], attemptB.cookie.split('=')[0]);
    assert.match(cleared, /Max-Age=0/);
    jar.delete(cleared.split('=')[0]);
    const header = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const stateB = f.db.rows.get(`_youtube_oauth_states/${digest(attemptB.state)}`)!;
    verifyOAuthBrowserState(new Request(attemptB.url, { headers: { cookie: header } }), 'youtube', String(stateB.browserSecretDigest));
    assertRedirect(await attemptB.finish({ cookie: header }), 'authorized');
    assert.equal((await (await f.accounts(businessB)).json()).channels.length, 1);
  }
});

test('Callback duplikat, kedaluwarsa, konfigurasi berubah, atau izin dibatalkan tidak memanggil Google', async () => {
  for (const mode of ['state', 'code', 'expired', 'client', 'secret', 'redirect', 'cancel'] as const) {
    const f = fixture();
    const attempt = await f.begin();
    let expectedOrigin = origin;
    if (mode === 'state' || mode === 'code') attempt.url.searchParams.append(mode, attempt.url.searchParams.get(mode)!);
    if (mode === 'expired') f.options.time += 600_000;
    if (mode === 'client') f.env.YOUTUBE_CLIENT_ID = 'rotated-client';
    if (mode === 'secret') f.env.YOUTUBE_CLIENT_SECRET = 'fixture-rotated-client-secret';
    if (mode === 'redirect') {
      expectedOrigin = 'https://other.example.test';
      f.env.YOUTUBE_REDIRECT_URI = expectedOrigin + callbackPath;
    }
    if (mode === 'cancel') {
      attempt.url.searchParams.delete('code');
      attempt.url.searchParams.set('error', 'access_denied');
      attempt.url.searchParams.set('error_description', secret);
    }
    assertRedirect(await attempt.finish(), 'failed', expectedOrigin);
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.rows.has(f.pending()), false);
    if (mode === 'cancel') {
      assert.equal(f.db.rows.has(`_youtube_oauth_states/${digest(attempt.state)}`), false);
      attempt.url.searchParams.delete('error');
      attempt.url.searchParams.set('code', code);
      assertRedirect(await attempt.finish(), 'failed');
      assert.equal(f.calls.length, 0);
    }
  }
});

test('Workspace di luar daftar hanya melihat koneksi lokal dan dapat memutuskannya', async () => {
  const f = fixture();
  const saved = await f.consent();
  assert.equal((await f.save(saved, channelA)).status, 200);
  const grant = await f.consent();
  const attempt = await f.begin(secondary);
  f.env.YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS = 'other-workspace';

  const before = structuredClone(f.db.rows);
  const writes = f.db.writeCount;
  const calls = f.calls.length;
  const view = await (await f.accounts()).json();
  assert.equal(view.configured, false);
  assert.equal(view.startRevision, 3);
  assert.deepEqual(view.channels, []);
  assert.equal('authorizationId' in view, false);
  assert.equal(view.connection.channelId, channelA);
  assert.equal(view.connection.revision, saved);
  assert.equal(view.connection.status, 'reconnect_required');

  const start = await f.start('primary', 0);
  assert.equal(start.headers.has('set-cookie'), false);
  await assertError(start, 503, 'youtube_not_configured');
  await assertError(await f.save(grant, channelA), 503, 'youtube_not_configured');
  const callback = await attempt.finish();
  assertRedirect(callback, 'failed');
  assert.equal(callback.headers.has('set-cookie'), false);
  assert.deepEqual(f.db.rows, before);
  assert.equal(f.db.writeCount, writes);
  assert.equal(f.calls.length, calls);

  assert.equal((await f.disconnect(channelA, saved)).status, 200);
  assert.equal((await (await f.accounts()).json()).connection, null);
  assert.equal(f.calls.length, calls);
});

test('Workspace yang dikeluarkan dari daftar selama discovery tidak menyimpan izin tertunda', async () => {
  const f = fixture();
  const attempt = await f.begin();
  f.options.beforeDiscovery = async () => { f.env.YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS = 'other-workspace'; };
  assertRedirect(await attempt.finish(), 'failed');
  assert.equal(f.calls.length, 2);
  assert.equal(f.db.rows.has(f.pending()), false);
});

test('Mutasi memerlukan pemilik aktual dan seluruh operasi memerlukan bisnis eksplisit yang masih ada', async () => {
  const f = fixture();
  await assertError(await startYouTube(f.request({ ...f.input(), startRevision: 0 }), { env: f.env }), 401, 'unauthenticated');
  await assertError(await startYouTube(f.request({ ...f.input(), workspaceId: 'foreign', startRevision: 0 }), f.deps), 403);
  await assertError(await startYouTube(f.request({ workspaceId, startRevision: 0 }), f.deps), 400);
  await assertError(await f.start(missing), 409, 'business_context_invalid');
  await assertError(await f.accounts(missing), 409, 'business_context_invalid');
  const grant = await f.consent();
  f.options.uid = member;
  assert.equal((await f.accounts()).status, 200);
  await assertError(await f.start(), 403);
  await assertError(await f.save(grant, channelA), 403);
  await assertError(await f.disconnect(channelA, grant), 403);
  f.options.uid = 'different-user-with-authorize-access';
  await assertError(await f.start(), 403);
  await assertError(await f.accounts(), 403);
  assert.ok(f.db.rows.has(f.pending()));
});

test('Simpan eksplisit menolak kanal palsu, menjaga koneksi saat consent gagal, dan hanya menyajikan metadata publik', async () => {
  const f = fixture();
  const encryptCalls: string[] = [];
  const deps = { ...f.deps, encrypt: (_pair: unknown, identity: { businessId: string }) => {
    encryptCalls.push(identity.businessId);
    return 'fixture-hidden-ciphertext';
  } };
  const attempt = await f.begin();
  assertRedirect(await youtubeCallback(new Request(attempt.url, { headers: { cookie: attempt.cookie } }), deps), 'authorized');
  const view = await (await f.accounts()).json();
  assert.deepEqual(encryptCalls, ['primary']);
  assert.equal(view.connection, null);
  assert.match(view.authorizationId, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(view.channels, [{ channelId: channelA, title: 'Kanal uji', handle: '@contoh', url: `https://www.youtube.com/channel/${channelA}` }]);
  assert.equal(f.db.rows.get(f.pending())?.encryptedTokens, 'fixture-hidden-ciphertext');
  assert.equal(f.db.rows.get(f.pending())?.scope, YOUTUBE_READONLY_SCOPE);
  for (const value of [secret, access, refresh, attempt.state, 'encryptedTokens', 'fixture-hidden-ciphertext', 'verifier', 'configBinding', 'clientId', YOUTUBE_READONLY_SCOPE]) assert.equal(JSON.stringify(view).includes(value), false);
  await assertError(await f.save(view.authorizationId, channelB), 409, 'youtube_channel_not_authorized');
  assert.equal(f.db.rows.has(f.connection()), false);
  assert.deepEqual(await (await f.save(view.authorizationId, channelA)).json(), { ok: true });
  const before = structuredClone(f.db.rows.get(f.connection()));
  assert.equal(before?.scope, YOUTUBE_READONLY_SCOPE);
  await assertError(await f.save(view.authorizationId, channelA), 409, 'reconnect_required');
  f.options.channel = channelB;
  f.options.offline = false;
  assertRedirect(await (await f.begin()).finish(), 'failed');
  assert.deepEqual(f.db.rows.get(f.connection()), before);
  assert.equal(f.db.rows.has(f.pending()), false);
  f.options.offline = true;
  const next = await f.consent();
  const stored = f.db.rows.get(f.pending())!;
  assert.deepEqual(decryptYouTubeTokens(String(stored.encryptedTokens), { workspaceId, businessId: 'primary', authorizationId: next }, key), { accessToken: access, refreshToken: refresh });
  assert.deepEqual((await (await f.accounts()).json()).connection, { ...view.channels[0], status: 'connected', connectedAt: f.options.time, revision: view.authorizationId });
  assert.deepEqual(f.db.rows.get(f.connection()), before);
  assert.equal((await f.save(next, channelB)).status, 200);
  assert.equal((await (await f.accounts()).json()).connection.channelId, channelB);
});

test('Perubahan pemilik ketika menukar kode atau sebelum menyimpan membatalkan grant', async () => {
  const f = fixture();
  const attempt = await f.begin();
  f.options.beforeDiscovery = async () => { f.db.rows.set(f.ref.path, { ...f.workspace, ownerUid: member }); };
  assertRedirect(await attempt.finish(), 'failed');
  assert.equal(f.calls.length, 2);
  assert.equal(f.db.rows.has(f.pending()), false);
  f.options.beforeDiscovery = async () => {};
  f.db.rows.set(f.ref.path, f.workspace);
  const grant = await f.consent();
  f.db.rows.set(f.ref.path, { ...f.workspace, ownerUid: member });
  await assertError(await f.save(grant, channelA), 403);
  f.options.uid = member;
  await assertError(await f.save(grant, channelA), 409, 'reconnect_required');
  assert.deepEqual((await (await f.accounts()).json()).channels, []);
});

test('Reconnect memagari consent lama dan disconnect lokal tidak menyentuh bisnis lain atau Meta', async () => {
  const f = fixture();
  const first = await f.consent();
  assert.equal((await f.save(first, channelA)).status, 200);
  const duplicate = await f.consent(secondary);
  await assertError(await f.save(duplicate, channelA, secondary), 409, 'youtube_channel_assigned');
  f.options.channel = channelB;
  assert.equal((await f.save(await f.consent(secondary), channelB, secondary)).status, 200);
  const secondConnection = structuredClone(f.db.rows.get(f.connection(secondary)));
  const secondGuard = structuredClone(f.db.rows.get(f.guard(secondary)));
  const stale = await f.consent();
  const older = await f.begin();
  const current = await f.begin();
  const calls = f.calls.length;
  await assertError(await f.save(stale, channelB), 409, 'reconnect_required');
  assertRedirect(await older.finish(), 'failed');
  assert.equal(f.calls.length, calls);
  f.options.beforeDiscovery = async () => { assert.equal((await f.disconnect(channelA, first)).status, 200); };
  assertRedirect(await current.finish(), 'failed');
  assert.equal(f.db.rows.has(f.pending()), false);
  assert.equal(f.db.rows.has(f.connection()), false);
  assert.deepEqual(f.db.rows.get(f.connection(secondary)), secondConnection);
  assert.deepEqual(f.db.rows.get(f.guard(secondary)), secondGuard);
  assert.deepEqual(f.db.rows.get(f.meta), { accountId: '123' });
});

test('Pemilik baru melihat kanal tersimpan dengan status perlu dihubungkan ulang', async () => {
  const f = fixture();
  const savedRevision = await f.consent();
  assert.equal((await f.save(savedRevision, channelA)).status, 200);
  const before = await (await f.accounts()).json();
  assert.equal(before.connection.status, 'connected');
  assert.equal(before.connection.revision, savedRevision);
  await f.consent();
  f.db.rows.set(f.ref.path, { ...f.workspace, ownerUid: member });
  f.options.uid = member;
  const after = await (await f.accounts()).json();
  assert.deepEqual(after.connection, { ...before.connection, status: 'reconnect_required' });
  assert.deepEqual(after.channels, []);
  assert.equal('authorizationId' in after, false);
  assert.equal(f.db.rows.get(f.connection())?.authorizedBy, owner);
});

test('Putuskan koneksi dari daftar lama gagal jika kanal atau revisi tersimpan berubah', async () => {
  for (const replacementChannel of [channelA, channelB]) {
    const f = fixture();
    const oldRevision = await f.consent();
    assert.equal((await f.save(oldRevision, channelA)).status, 200);
    f.options.channel = replacementChannel;
    const newRevision = await f.consent();
    assert.notEqual(newRevision, oldRevision);
    assert.equal((await f.save(newRevision, replacementChannel)).status, 200);
    const pendingRevision = await f.consent();
    const before = structuredClone(f.db.rows);
    const writes = f.db.writeCount;

    await assertError(await f.disconnect(channelA, oldRevision), 409, 'youtube_connection_conflict');
    if (replacementChannel !== channelA) {
      await assertError(await f.disconnect(channelA, newRevision), 409, 'youtube_connection_conflict');
    }
    await assertError(await disconnectYouTube(f.request({ ...f.input(), channelId: replacementChannel }, 'DELETE'), f.deps), 400, 'invalid_request');
    assert.deepEqual(f.db.rows, before);
    assert.equal(f.db.writeCount, writes);
    assert.equal((await (await f.accounts()).json()).authorizationId, pendingRevision);
  }
});

test('Pengulangan putuskan koneksi yang sudah terputus mempertahankan opsi consent baru', async () => {
  const f = fixture();
  const previousRevision = await f.consent();
  assert.equal((await f.save(previousRevision, channelA)).status, 200);
  assert.deepEqual(await (await f.disconnect(channelA, previousRevision)).json(), { ok: true });

  const pendingRevision = await f.consent();
  const before = structuredClone(f.db.rows);
  const writes = f.db.writeCount;
  assert.deepEqual(await (await f.disconnect(channelA, previousRevision)).json(), { ok: true });
  assert.deepEqual(f.db.rows, before);
  assert.equal(f.db.writeCount, writes);
  const view = await (await f.accounts()).json();
  assert.equal(view.connection, null);
  assert.equal(view.authorizationId, pendingRevision);
  assert.equal((await f.save(pendingRevision, channelA)).status, 200);
});

test('Seleksi tertunda habis dalam sepuluh menit dan konfigurasi nonaktif hanya menyajikan status lokal', async () => {
  const f = fixture();
  const grant = await f.consent();
  f.options.time += 600_000;
  await assertError(await f.save(grant, channelA), 409, 'reconnect_required');
  assert.deepEqual((await (await f.accounts()).json()).channels, []);
  const fresh = await f.consent();
  assert.equal((await f.save(fresh, channelA)).status, 200);
  const calls = f.calls.length;
  delete f.env.YOUTUBE_CLIENT_SECRET;
  const response = await f.accounts();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const view = await response.json();
  assert.equal(view.configured, false);
  assert.equal(view.startRevision, 3);
  assert.equal(view.connection.status, 'reconnect_required');
  assert.deepEqual(view.channels, []);
  assert.equal('authorizationId' in view, false);
  await assertError(await f.start('primary', view.startRevision), 503, 'youtube_not_configured');
  assert.equal(f.calls.length, calls);
  assert.equal((await f.disconnect(channelA, fresh)).status, 200);
  delete f.env.YOUTUBE_REDIRECT_URI;
  const callback = await youtubeCallback(new Request('https://untrusted.example.test' + callbackPath), f.deps);
  assert.equal(callback.headers.has('location'), false);
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  await assertError(callback, 503, 'youtube_not_configured');
});
