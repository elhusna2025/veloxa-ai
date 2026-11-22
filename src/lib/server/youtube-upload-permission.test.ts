import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { blankBusinessProfile } from '../business-context';
import { YOUTUBE_CALLBACK_PATH, YOUTUBE_READONLY_SCOPE, youtubeConfig } from './youtube-config';
import { encryptYouTubeTokens } from './youtube-crypto';
import { disconnectYouTube, selectYouTubeConnection, startYouTube } from './youtube-oauth';
import { assertSingleYouTubeUploadChannel, assertYouTubeUploadBinding, getYouTubeUploadAccess, invalidateYouTubeUploadAccessToken, loadYouTubeUploadCredentials, type YouTubeUploadDependencies } from './youtube-upload-auth';
import { youtubeUploadAction, youtubeUploadCreate, youtubeUploadGet } from './youtube-upload-jobs';
import { sealYouTubeSession } from './youtube-upload-transfer';
import { confirmYouTubeUploadPermission, dispatchYouTubeCallback, getYouTubeUploadPermission, startYouTubeUploadPermission } from './youtube-upload-permission';
import type { YouTubeUploadPermission } from '../youtube-upload-types';

const workspaceId = 'ws_fixture';
const owner = 'fixture-owner';
const businessId = 'primary';
const channelId = `UC${'A'.repeat(22)}`;
const otherChannel = `UC${'B'.repeat(22)}`;
const connectionRevision = 'R'.repeat(43);
const scope = { workspaceId, businessId };
const target = { ...scope, channelId, connectionRevision };
const origin = 'https://studio.example.test';
const uploadScope = `${YOUTUBE_READONLY_SCOPE} https://www.googleapis.com/auth/youtube.upload`;
const env = {
  YOUTUBE_OAUTH_ENABLED: 'true', YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS: workspaceId,
  YOUTUBE_REDIRECT_URI: origin + YOUTUBE_CALLBACK_PATH, YOUTUBE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
  YOUTUBE_CLIENT_SECRET: 'fixture-client-secret', YOUTUBE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const config = youtubeConfig(env)!;
const ws = `workspaces/${workspaceId}`;
const connectionPath = `${ws}/private_youtube_connections/${businessId}`;
const readonlyPendingPath = `${ws}/private_youtube_authorizations/${businessId}`;
const grantPath = `${ws}/private_youtube_upload_grants/${businessId}`;
const pendingPath = `${ws}/private_youtube_upload_authorizations/${businessId}`;
const guardPath = `${ws}/integration_guards/youtube_upload_${businessId}`;
const dispatchPath = `${ws}/youtube_upload_dispatch/${businessId}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const statePath = (state: string) => `_youtube_upload_oauth_states/${hash(state)}`;
type Row = Record<string, unknown>;
type Destination = { kind: 'doc' | 'query'; path: string; filter?: [string, unknown] };

class FakeDatabase {
  readonly rows = new Map<string, Row>();
  writes = 0;
  snapshot(path: string) {
    const row = this.rows.get(path);
    return { id: path.split('/').at(-1)!, exists: row !== undefined, data: () => row && structuredClone(row) };
  }
  doc(path: string) {
    return { kind: 'doc' as const, path, id: path.split('/').at(-1)!, firestore: this,
      collection: (name: string) => this.collection(`${path}/${name}`), get: async () => this.snapshot(path) };
  }
  collection(path: string) {
    return { kind: 'query' as const, path, doc: (id: string) => this.doc(`${path}/${id}`),
      where: (field: string, op: string, value: unknown): Destination => {
        assert.equal(op, '==');
        return { kind: 'query', path, filter: [field, value] };
      } };
  }
  async runTransaction<T>(run: (tx: FirebaseFirestore.Transaction) => Promise<T>): Promise<T> {
    const writes: (() => void)[] = [];
    const tx = {
      get: async ({ kind, path, filter }: Destination) => {
        assert.equal(writes.length, 0, 'Semua pembacaan transaksi harus mendahului penulisan.');
        if (kind === 'doc') return this.snapshot(path);
        const prefix = `${path}/`;
        return { docs: [...this.rows.entries()].filter(([key, value]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/') &&
          (!filter || value[filter[0]] === filter[1])).map(([key]) => this.snapshot(key)) };
      },
      set: ({ path }: Destination, row: Row) => { writes.push(() => this.rows.set(path, structuredClone(row))); },
      create: ({ path }: Destination, row: Row) => {
        assert.ok(!this.rows.has(path));
        writes.push(() => this.rows.set(path, structuredClone(row)));
      },
      delete: ({ path }: Destination) => { writes.push(() => this.rows.delete(path)); },
      update: ({ path }: Destination, row: Row) => {
        assert.ok(this.rows.has(path));
        writes.push(() => this.rows.set(path, { ...this.rows.get(path), ...structuredClone(row) }));
      },
    };
    const result = await run(tx as unknown as FirebaseFirestore.Transaction);
    writes.forEach(write => write());
    this.writes += writes.length;
    return result;
  }
}

function request(body?: object) {
  const url = `${origin}/api/veloxa/youtube/upload-permission?${new URLSearchParams(scope)}`;
  return body ? new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) : new Request(url);
}

function fixture() {
  const db = new FakeDatabase();
  let time = 1_800_000_000_000;
  const now = () => time;
  const ref = db.doc(ws);
  const brand = blankBusinessProfile(workspaceId, businessId, 'Bisnis QA');
  db.rows.set(ws, { ownerUid: owner, snapshotJson: JSON.stringify({ brand }) });
  const channel = { channelId, title: 'Kanal QA', handle: '@fixture', url: `https://www.youtube.com/channel/${channelId}` };
  const readonlyGrant = {
    clientId: config.clientId, configBinding: config.configBinding, authorizedBy: owner, generation: 1,
    accessExpiresAt: now() + 3_600_000, scope: YOUTUBE_READONLY_SCOPE,
  };
  const readonlyCipher = (authorizationId: string) => encryptYouTubeTokens({ accessToken: 'readonly-access', refreshToken: 'readonly-refresh' },
    { ...scope, authorizationId }, config.encryptionKey);
  db.rows.set(connectionPath, { ...channel, ...readonlyGrant, authorizationId: connectionRevision, encryptedTokens: readonlyCipher(connectionRevision), connectedAt: now() });
  const deps: YouTubeUploadDependencies = {
    env, now, database: db as unknown as NonNullable<YouTubeUploadDependencies['database']>,
    authorize: (async () => ({ ref, user: { uid: owner, role: 'admin' } })) as unknown as NonNullable<YouTubeUploadDependencies['authorize']>,
    fetcher: async () => { assert.fail('Provider tidak dijadwalkan untuk dipanggil.'); },
  };
  const seedReadonlySelection = (authorizationId: string) => db.rows.set(readonlyPendingPath, {
    ...readonlyGrant, generation: 0, authorizationId, encryptedTokens: readonlyCipher(authorizationId), expiresAt: now() + 600_000,
    channels: [{ channelId: otherChannel, title: 'Kanal kedua', handle: '' }],
  });
  return { db, deps, seedReadonlySelection, advance: (ms: number) => { time += ms; } };
}
type Fixture = ReturnType<typeof fixture>;

function provider(options: { ids?: string[]; token?: Row; afterChannels?: () => void } = {}): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.redirect, 'error');
    if (url.href === 'https://oauth2.googleapis.com/token') {
      assert.equal((init?.body as URLSearchParams).get('grant_type'), 'authorization_code');
      return Response.json(options.token ?? { access_token: 'upload-access', refresh_token: 'upload-refresh', expires_in: 3600, token_type: 'Bearer', scope: uploadScope });
    }
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/channels');
    assert.equal(url.searchParams.get('mine'), 'true');
    options.afterChannels?.();
    return Response.json({ items: (options.ids ?? [channelId]).map(id => ({ id, snippet: { title: 'Kanal QA' } })) });
  };
}

async function read(f: Fixture) {
  const writes = f.db.writes;
  const reply = await getYouTubeUploadPermission(request(), f.deps);
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('cache-control'), 'no-store');
  assert.equal(f.db.writes, writes);
  return await reply.json() as YouTubeUploadPermission;
}

async function attempt(f: Fixture, startRevision = 0) {
  const reply = await startYouTubeUploadPermission(request({ ...target, startRevision }), f.deps);
  assert.equal(reply.status, 200);
  const url = new URL((await reply.json()).url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), uploadScope);
  assert.equal(url.searchParams.get('redirect_uri'), env.YOUTUBE_REDIRECT_URI);
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const state = url.searchParams.get('state')!;
  const cookie = reply.headers.get('set-cookie')!.split(';', 1)[0];
  const record = f.db.rows.get(statePath(state))!;
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(cookie.split('=')[1], state);
  assert.equal(record.browserSecretDigest, hash(cookie.split('=')[1]));
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(String(record.verifier)).digest('base64url'));
  assert.equal((record.deleteAt as Date).getTime(), record.expiresAt);
  return { state, cookie };
}

type Attempt = Awaited<ReturnType<typeof attempt>>;
async function callback(f: Fixture, authorization: Attempt, fetcher: typeof fetch, cookie = authorization.cookie) {
  return dispatchYouTubeCallback(new Request(`${env.YOUTUBE_REDIRECT_URI}?${new URLSearchParams({ state: authorization.state, code: 'fixture-code' })}`,
    { headers: { cookie } }), { ...f.deps, fetcher });
}

async function consent(f: Fixture, startRevision = 0) {
  const response = await callback(f, await attempt(f, startRevision), provider());
  assert.equal(response.headers.get('location'), `${origin}/?youtube_upload=authorized`);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const result = await read(f);
  assert.ok(result.pending);
  return result.pending;
}

async function confirm(f: Fixture, authorizationId: string) {
  return confirmYouTubeUploadPermission(request({ ...target, authorizationId }), f.deps);
}

async function approve(f: Fixture, startRevision = 0) {
  const pending = await consent(f, startRevision);
  assert.equal((await confirm(f, pending.authorizationId)).status, 200);
  return getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps);
}

test('rekonsiliasi setelah retensi membersihkan media dan hanya melepas fence dengan bukti sesi yang sama', async () => {
  const f = fixture();
  const access = await approve(f);
  const id = '00000000-0000-4000-8000-000000000001';
  const key = `${hash(JSON.stringify([workspaceId, businessId, owner]))}_${id}`;
  const path = `private_youtube_uploads/${key}`;
  const session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=review-fixture';
  const context = JSON.stringify(['youtube-upload-session-v1', key, workspaceId, businessId, owner, channelId, connectionRevision, access.binding.grantId]);
  const sealed = sealYouTubeSession(session, context, config.encryptionKey);
  let credentialLoads = 0;
  let cleanupCalls = 0;
  let sessionChecks = 0;
  let videoChecks = 0;
  let replacement: typeof access.binding | undefined;
  const deps = {
    ...f.deps,
    env: { ...f.deps.env, YOUTUBE_UPLOAD_STORAGE_RETENTION_READY: 'true' },
    authorize: (async () => ({ ref: f.db.doc(ws), user: { uid: owner }, workspace: { ownerUid: owner } })) as unknown as NonNullable<YouTubeUploadDependencies['authorize']>,
    uploadAccess: async () => access,
    config: () => config,
    credentials: (binding: typeof access.binding) => {
      credentialLoads++;
      if (binding.grantId === replacement?.grantId) {
        assert.deepEqual(binding, replacement);
        return loadYouTubeUploadCredentials(binding, f.deps);
      }
      assert.deepEqual(binding, access.binding);
      return loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }) });
    },
    media: {
      stage: async () => assert.fail('Rekonsiliasi tidak menyimpan bagian video.'),
      compose: async () => assert.fail('Rekonsiliasi tidak menyusun file.'),
      measure: async () => assert.fail('Rekonsiliasi tidak memeriksa ulang file.'),
      read: async () => assert.fail('Rekonsiliasi tidak membaca media untuk pengiriman.'),
      cleanup: async () => { cleanupCalls++; },
    },
    provider: {
      start: async () => assert.fail('Rekonsiliasi tidak membuka sesi baru.'),
      video: async (token: string, id: string) => {
        assert.equal(token, 'fixture-reconciliation-access');
        assert.equal(id, 'FixtureID01');
        videoChecks++;
        return { id, snippet: { channelId }, status: { privacyStatus: 'private' as const, uploadStatus: 'processed' as const } };
      },
      transfer: async (token: string, uri: string, total: number, _signal: AbortSignal, chunk?: { start: number; bytes: Buffer }) => {
        assert.equal(token, 'fixture-reconciliation-access');
        assert.equal(uri, session);
        assert.equal(total, 1);
        assert.equal(chunk, undefined);
        sessionChecks++;
        if (sessionChecks === 1) return { kind: 'progress' as const, offset: 0 };
        return { kind: 'complete' as const, video: {
          id: 'FixtureID01', snippet: { channelId: sessionChecks === 2 ? otherChannel : channelId },
          status: { privacyStatus: 'private' as const },
        } };
      },
    },
  };
  const created = await youtubeUploadCreate(request({
    ...target, operationId: id, kind: 'video', confirmed: true,
    file: { name: 'fixture.mp4', size: 1, mimeType: 'video/mp4', chunkHashes: [hash('x')] },
    metadata: { title: 'Video QA', description: '', privacy: 'private', madeForKids: false, containsSyntheticMedia: false },
  }), deps);
  assert.equal(created.status, 200);
  deps.env.YOUTUBE_UPLOAD_STORAGE_RETENTION_READY = 'false';
  f.db.rows.set(path, { ...f.db.rows.get(path), state: 'uploading', encryptedSession: sealed, finalIntent: true, nextRunAt: f.deps.now!() });
  f.db.rows.set(dispatchPath, { jobId: key, state: 'active' });
  const action = async (name: 'process' | 'check') => {
    const response = await youtubeUploadAction(request({ ...scope, action: name }), id, deps);
    assert.equal(response.status, 200);
    return (await response.json()).operation;
  };
  const assertFenced = () => assert.deepEqual(f.db.rows.get(dispatchPath), { jobId: key, state: 'unknown' });
  f.advance(3_600_000);
  assert.equal((await action('process')).state, 'needs_review');
  assert.equal(f.db.rows.get(grantPath)?.permissionInvalidated, true);
  assertFenced();
  f.advance(11_000);
  await action('process');
  assert.equal(cleanupCalls, 1);
  const cleaned = f.db.rows.get(path)!;
  assert.equal(cleaned.mediaCleaned, true);
  assert.equal(cleaned.encryptedSession, sealed);
  // Simulasikan juga rekaman lama yang dijadwalkan untuk purge setelah media dibersihkan.
  f.db.rows.set(path, { ...cleaned, nextRunAt: cleaned.historyUntil });
  f.advance(31 * 24 * 60 * 60_000);
  assert.equal((await action('process')).state, 'needs_review');
  assert.equal(cleanupCalls, 1);
  const writes = f.db.writes;
  assert.equal((await youtubeUploadGet(request(), id, deps)).status, 200);
  assert.equal(f.db.writes, writes);
  assert.equal(f.db.rows.get(path)?.encryptedSession, sealed);
  assertFenced();
  assert.equal((await action('check')).state, 'needs_review');
  assert.equal(sessionChecks, 0);
  assertFenced();

  await callback(f, await attempt(f, 1), provider({ token: {
    access_token: 'fixture-reconciliation-access', refresh_token: 'fixture-reconciliation-refresh',
    expires_in: 3600, token_type: 'Bearer', scope: uploadScope,
  } }));
  const pending = (await read(f)).pending;
  assert.ok(pending);
  assert.equal((await confirm(f, pending.authorizationId)).status, 409);
  const loadsBeforeRecovery = credentialLoads;
  for (const expectedChecks of [1, 2]) {
    f.advance(11_000);
    assert.equal((await action('check')).state, 'needs_review');
    assert.equal(sessionChecks, expectedChecks);
    assertFenced();
  }
  f.advance(11_000);
  const recovered = await action('check');
  assert.equal(recovered.state, 'processing');
  assert.equal(recovered.video.id, 'FixtureID01');
  assert.equal(sessionChecks, 3);
  assert.equal(credentialLoads, loadsBeforeRecovery);
  assert.ok(!f.db.rows.has(dispatchPath));
  assert.equal(f.db.rows.get(path)?.encryptedSession, null);
  assert.equal((await youtubeUploadGet(request(), id, deps)).status, 200);
  const review = await read(f);
  assert.equal(review.pending?.authorizationId, pending.authorizationId);
  assert.equal(review.canUpload, false);
  assert.equal((await confirm(f, pending.authorizationId)).status, 200);
  replacement = (await getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps)).binding;
  assert.notEqual(replacement.grantId, access.binding.grantId);
  const approved = f.db.rows.get(grantPath)!;
  for (const mismatch of [{ ownerUid: 'wrong-owner' }, { channelId: otherChannel }, { connectionRevision: 'B'.repeat(43) }]) {
    f.db.rows.set(grantPath, { ...approved, ...mismatch });
    f.advance(11_000);
    assert.equal((await action('check')).state, 'needs_review');
    assert.equal(videoChecks, 0);
  }
  f.db.rows.set(grantPath, approved);
  f.advance(11_000);
  const ready = await action('check');
  assert.equal(ready.state, 'ready');
  assert.equal(ready.video.id, 'FixtureID01');
  assert.equal(videoChecks, 1);
  assert.equal(sessionChecks, 3);
  assert.equal(cleanupCalls, 1);
  assert.deepEqual(f.db.rows.get(path)?.binding, access.binding);
  assert.equal(f.db.rows.get(path)?.encryptedSession, null);
});

test('DTO izin hanya untuk pemilik aktual, bisnis eksplisit dan koneksi yang diizinkan', async () => {
  const f = fixture();
  const dto = await read(f);
  assert.deepEqual(dto, { ok: true, configured: true, startRevision: 0, canUpload: false, uploadStorageReady: false, connection: {
    channelId, title: 'Kanal QA', handle: '@fixture', url: `https://www.youtube.com/channel/${channelId}`, revision: connectionRevision, status: 'connected',
  } });
  const outside = await getYouTubeUploadPermission(request(), { ...f.deps, env: { ...env, YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS: 'different-workspace' } });
  const outsideDto = await outside.json();
  assert.equal(outsideDto.configured, false);
  assert.equal(outsideDto.canUpload, false);
  assert.equal(outsideDto.connection.status, 'reconnect_required');
  const wrong = 'b_00000000-0000-4000-8000-000000000001';
  assert.equal((await startYouTubeUploadPermission(request({ ...target, businessId: wrong, startRevision: 0 }), f.deps)).status, 409);
  assert.equal((await startYouTubeUploadPermission(request({ ...target, businessId: '', startRevision: 0 }), f.deps)).status, 400);
  const admin = { ...f.deps, authorize: (async () => ({ ref: f.db.doc(ws), user: { uid: 'non-owner', role: 'admin' } })) as unknown as NonNullable<YouTubeUploadDependencies['authorize']> };
  assert.equal((await getYouTubeUploadPermission(request(), admin)).status, 403);
  await assert.rejects(getYouTubeUploadAccess(request(), workspaceId, businessId, admin));
  f.db.rows.set(ws, { ...f.db.rows.get(ws), ownerUid: undefined });
  assert.equal((await startYouTubeUploadPermission(request({ ...target, startRevision: 0 }), f.deps)).status, 403);
  assert.equal(f.db.writes, 0);
});

test('CAS awal menolak revisi usang; callback memeriksa kembali target sebelum dan sesudah provider', async () => {
  const f = fixture();
  assert.equal((await startYouTubeUploadPermission(request({ ...target, connectionRevision: 'S'.repeat(43), startRevision: 0 }), f.deps)).status, 409);
  assert.equal(f.db.writes, 0);
  const first = await attempt(f);
  assert.equal((await startYouTubeUploadPermission(request({ ...target, startRevision: 0 }), f.deps)).status, 409);
  const original = f.db.rows.get(connectionPath)!;
  f.db.rows.set(connectionPath, { ...original, authorizationId: 'S'.repeat(43) });
  let calls = 0;
  assert.equal((await callback(f, first, async () => { calls++; return Response.json({}); })).headers.get('location'), `${origin}/?youtube_upload=failed`);
  assert.equal(calls, 0);
  f.db.rows.set(connectionPath, original);
  const second = await attempt(f, 1);
  const response = await callback(f, second, provider({ afterChannels: () => f.db.rows.set(ws, { ...f.db.rows.get(ws), ownerUid: 'owner-baru' }) }));
  assert.equal(response.headers.get('location'), `${origin}/?youtube_upload=failed`);
  assert.ok(!f.db.rows.has(pendingPath));
});

test('bukti browser palsu tidak mengonsumsi state; replay tidak menukar kode atau menerbitkan pending lagi', async () => {
  const f = fixture();
  const first = await attempt(f);
  const forged = `${first.cookie.split('=')[0]}=${first.state}`;
  let calls = 0;
  const unexpected: typeof fetch = async () => { calls++; return Response.json({}); };
  const bad = await callback(f, first, unexpected, forged);
  assert.equal(bad.headers.get('location'), `${origin}/?youtube_upload=failed`);
  assert.equal(bad.headers.get('set-cookie'), null);
  assert.ok(f.db.rows.has(statePath(first.state)));
  const good = await callback(f, first, provider());
  assert.equal(good.headers.get('location'), `${origin}/?youtube_upload=authorized`);
  assert.match(good.headers.get('set-cookie')!, /Max-Age=0/i);
  assert.ok(!f.db.rows.has(statePath(first.state)));
  const before = f.db.rows.get(pendingPath);
  await callback(f, first, unexpected);
  assert.equal(calls, 0);
  assert.deepEqual(f.db.rows.get(pendingPath), before);
});

test('callback unggah lama hanya menghapus cookie percobaannya; callback baca tetap memakai alur lama', async () => {
  const f = fixture();
  const first = await attempt(f);
  const second = await attempt(f, 1);
  const readonly = await startYouTube(request({ ...scope, startRevision: 0 }), f.deps);
  assert.equal(readonly.status, 200);
  const readonlyState = new URL((await readonly.json()).url).searchParams.get('state')!;
  const readonlyCookie = readonly.headers.get('set-cookie')!.split(';', 1)[0];
  const cookies = [first.cookie, second.cookie, readonlyCookie].join('; ');
  const older = await callback(f, first, f.deps.fetcher!, cookies);
  assert.equal(older.headers.get('location'), `${origin}/?youtube_upload=failed`);
  assert.equal(older.headers.get('set-cookie')!.split('=')[0], first.cookie.split('=')[0]);
  const saved = await callback(f, second, provider(), cookies);
  assert.equal(saved.headers.get('location'), `${origin}/?youtube_upload=authorized`);
  assert.equal(saved.headers.get('set-cookie')!.split('=')[0], second.cookie.split('=')[0]);
  const readonlyFinish = await callback(f, { state: readonlyState, cookie: readonlyCookie }, provider({ token: {
    access_token: 'readonly-access', refresh_token: 'readonly-refresh', expires_in: 3600, token_type: 'Bearer', scope: YOUTUBE_READONLY_SCOPE,
  } }), cookies);
  assert.equal(readonlyFinish.headers.get('location'), `${origin}/?youtube=authorized`);
  assert.equal(readonlyFinish.headers.get('set-cookie')!.split('=')[0], readonlyCookie.split('=')[0]);
  assert.ok(f.db.rows.has(readonlyPendingPath));
  assert.ok(f.db.rows.has(pendingPath));
});

test('kanal salah, kanal tambahan pada halaman lain, scope tambahan dan token refresh hilang tidak mengganti grant', async () => {
  const f = fixture();
  await approve(f);
  const saved = f.db.rows.get(grantPath);
  const token = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer', scope: uploadScope };
  const invalidProviders = [provider({ ids: [otherChannel] }), provider({ ids: [channelId, otherChannel] }),
    provider({ token: { ...token, scope: `${uploadScope} openid` } }), provider({ token: { ...token, refresh_token: undefined } })];
  for (const [index, fetcher] of invalidProviders.entries()) {
    const response = await callback(f, await attempt(f, index + 1), fetcher);
    assert.equal(response.headers.get('location'), `${origin}/?youtube_upload=failed`);
    assert.ok(!f.db.rows.has(pendingPath));
    assert.deepEqual(f.db.rows.get(grantPath), saved);
  }
  let pages = 0;
  await assert.rejects(assertSingleYouTubeUploadChannel('upload-access', channelId, { fetcher: async input => {
    const cursor = new URL(String(input)).searchParams.get('pageToken');
    pages++;
    return cursor ? Response.json({ items: [{ id: otherChannel }] }) : Response.json({ items: [{ id: channelId }], nextPageToken: 'next' });
  } }));
  assert.equal(pages, 2);
});

test('pending harus dikonfirmasi eksplisit; penggantian grant tidak mengubah koneksi baca', async () => {
  const f = fixture();
  const readonly = f.db.rows.get(connectionPath);
  const first = await consent(f);
  assert.ok(!f.db.rows.has(grantPath));
  assert.equal((await read(f)).canUpload, false);
  assert.deepEqual(Object.keys(first).sort(), ['authorizationId', 'channelId', 'connectionRevision', 'handle', 'title', 'url']);
  assert.equal((await confirm(f, 'X'.repeat(43))).status, 409);
  assert.equal((await confirm(f, first.authorizationId)).status, 200);
  assert.equal((await confirm(f, first.authorizationId)).status, 409);
  const access = await getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps);
  assert.notEqual(access.binding.grantId, first.authorizationId);
  const second = await consent(f, 1);
  assert.equal(f.db.rows.get(grantPath)?.grantId, access.binding.grantId);
  assert.equal((await read(f)).canUpload, true);
  assert.equal((await confirm(f, second.authorizationId)).status, 200);
  assert.deepEqual(f.db.rows.get(connectionPath), readonly);
  assert.notEqual(f.db.rows.get(grantPath)?.grantId, access.binding.grantId);
  await assert.rejects(loadYouTubeUploadCredentials(access.binding, f.deps));
  const current = await getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps);
  await f.db.runTransaction(tx => assertYouTubeUploadBinding(tx, current.ref, current.binding, current.config));
  const expired = await consent(f, 2);
  f.advance(600_000);
  assert.equal((await read(f)).pending, undefined);
  assert.equal((await confirm(f, expired.authorizationId)).status, 409);
  assert.equal(f.db.rows.get(grantPath)?.grantId, current.binding.grantId);
});

test('fence active dan unknown menahan konfirmasi tanpa mengubah grant, pending, atau koneksi baca', async () => {
  const f = fixture();
  const access = await approve(f);
  const grant = f.db.rows.get(grantPath);
  const readonly = f.db.rows.get(connectionPath);
  f.db.rows.set(dispatchPath, { jobId: 'fixture-job', state: 'active' });
  const review = await consent(f, 1);
  const pending = f.db.rows.get(pendingPath);
  const writes = f.db.writes;
  for (const state of ['active', 'unknown']) {
    f.db.rows.set(dispatchPath, { jobId: 'fixture-job', state });
    assert.equal((await confirm(f, review.authorizationId)).status, 409);
    assert.equal(f.db.writes, writes);
    assert.deepEqual(f.db.rows.get(grantPath), grant);
    assert.deepEqual(f.db.rows.get(pendingPath), pending);
    assert.deepEqual(f.db.rows.get(connectionPath), readonly);
  }
  f.db.rows.delete(dispatchPath);
  assert.equal((await confirm(f, review.authorizationId)).status, 200);
  const replacement = await getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps);
  assert.notEqual(replacement.binding.grantId, access.binding.grantId);
  assert.ok(!f.db.rows.has(pendingPath));
  assert.deepEqual(f.db.rows.get(connectionPath), readonly);
});

test('fence active dan unknown menahan pilih dan putus; putus tanpa koneksi tidak menghapus pending', async () => {
  const f = fixture();
  await approve(f);
  await consent(f, 1);
  const selectionId = 'V'.repeat(43);
  f.seedReadonlySelection(selectionId);
  const select = () => selectYouTubeConnection(request({ ...scope, authorizationId: selectionId, channelId: otherChannel }), f.deps);
  const disconnect = () => disconnectYouTube(request({ ...scope, channelId, revision: connectionRevision }), f.deps);
  const pending = f.db.rows.get(pendingPath);
  const writes = f.db.writes;
  for (const state of ['active', 'unknown']) {
    f.db.rows.set(dispatchPath, { jobId: 'fixture-job', state, createdAt: 0 });
    assert.equal((await select()).status, 409);
    assert.equal((await disconnect()).status, 409);
  }
  assert.equal(f.db.writes, writes);
  assert.deepEqual(f.db.rows.get(pendingPath), pending);
  f.db.rows.delete(dispatchPath);
  assert.equal((await select()).status, 200);
  assert.equal(f.db.rows.get(connectionPath)?.channelId, otherChannel);
  assert.ok(!f.db.rows.has(grantPath));
  assert.ok(!f.db.rows.has(pendingPath));
  assert.equal((await disconnect()).status, 409);
  const fresh = fixture();
  await approve(fresh);
  await consent(fresh, 1);
  assert.equal((await disconnectYouTube(request({ ...scope, channelId, revision: connectionRevision }), fresh.deps)).status, 200);
  assert.ok(!fresh.db.rows.has(grantPath));
  assert.ok(!fresh.db.rows.has(pendingPath));
  fresh.db.rows.set(pendingPath, pending!);
  assert.equal((await disconnectYouTube(request({ ...scope, channelId, revision: connectionRevision }), fresh.deps)).status, 200);
  assert.deepEqual(fresh.db.rows.get(pendingPath), pending);
});

test('refresh menyimpan rotasi dengan CAS dan tidak memakai kredensial grant pengganti', async () => {
  const f = fixture();
  const access = await approve(f);
  f.advance(3_550_000);
  const reply = (accessToken: string, refreshToken?: string) => Response.json({
    access_token: accessToken, ...(refreshToken ? { refresh_token: refreshToken } : {}), expires_in: 3600, token_type: 'Bearer',
  });
  const winning: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://oauth2.googleapis.com/token');
    assert.equal((init?.body as URLSearchParams).get('refresh_token'), 'upload-refresh');
    return reply('winner-access', 'rotated-refresh');
  };
  const result = await loadYouTubeUploadCredentials(access.binding, { ...f.deps, fetcher: winning });
  assert.equal(result.accessToken, 'winner-access');
  assert.equal((await loadYouTubeUploadCredentials(access.binding, f.deps)).accessToken, 'winner-access');
  f.advance(3_550_000);
  await loadYouTubeUploadCredentials(access.binding, { ...f.deps, fetcher: async (_input, init) => {
    assert.equal((init?.body as URLSearchParams).get('refresh_token'), 'rotated-refresh');
    return reply('next-access');
  } });
  f.advance(3_550_000);
  const before = f.db.rows.get(grantPath);
  const readonly = f.db.rows.get(connectionPath);
  let sent = '';
  await assert.rejects(loadYouTubeUploadCredentials(access.binding, { ...f.deps, fetcher: async (_input, init) => {
    sent = (init?.body as URLSearchParams).get('refresh_token')!;
    return Response.json({ error: 'invalid_grant', error_description: 'fixture-private-provider-detail' }, { status: 400 });
  } }), { message: 'Izin unggah YouTube tidak lagi berlaku. Periksa koneksi dan berikan izin kembali.' });
  assert.equal(sent, 'rotated-refresh');
  assert.deepEqual(f.db.rows.get(grantPath), { ...before, permissionInvalidated: true });
  const denied = await read(f);
  assert.equal(denied.canUpload, false);
  assert.equal(denied.connection?.status, 'connected');
  assert.deepEqual(f.db.rows.get(connectionPath), readonly);
  await assert.rejects(getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps), { code: 'needs_permission' });
  await assert.rejects(f.db.runTransaction(tx => assertYouTubeUploadBinding(tx, access.ref, access.binding, access.config)), { code: 'needs_permission' });
  const reauthorized = await approve(f, 1);
  f.advance(3_550_000);
  let replacementId: string | undefined;
  await assert.rejects(loadYouTubeUploadCredentials(reauthorized.binding, { ...f.deps, fetcher: async () => {
    replacementId = (await approve(f, 2)).binding.grantId;
    return reply('old-grant-access');
  } }), { code: 'needs_permission' });
  assert.ok(replacementId);
  const replacement = await getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps);
  assert.equal(replacement.binding.grantId, replacementId);
  assert.equal((await loadYouTubeUploadCredentials(replacement.binding, f.deps)).accessToken, 'upload-access');
});

test('401 dapat memaksa refresh; invalidasi tidak menandai token yang sudah diganti', async () => {
  const f = fixture();
  const original = (await approve(f)).binding;
  let refreshes = 0;
  const rotated = await loadYouTubeUploadCredentials(original, {
    ...f.deps,
    fetcher: async (_input, init) => {
      refreshes++;
      assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'), 'refresh_token');
      return Response.json({ access_token: 'fixture-rotated-access', expires_in: 3600, token_type: 'Bearer' });
    },
  }, 'upload-access');
  assert.equal(refreshes, 1);
  assert.equal(rotated.accessToken, 'fixture-rotated-access');
  assert.equal(await invalidateYouTubeUploadAccessToken(original, 'upload-access', f.deps), false);
  assert.equal((await read(f)).canUpload, true);
  assert.equal(await invalidateYouTubeUploadAccessToken(original, 'fixture-rotated-access', f.deps), true);
  assert.equal((await read(f)).canUpload, false);
});

function deferred() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('refresh kedua tidak mencapai Google sebelum rotasi pertama tersimpan', async () => {
  const f = fixture();
  const { binding } = await approve(f);
  f.advance(3_550_000);
  const started = deferred();
  const finish = deferred();
  let duplicateCalls = 0;
  const winner = loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async (_input, init) => {
    assert.equal((init?.body as URLSearchParams).get('refresh_token'), 'upload-refresh');
    started.release();
    await finish.promise;
    return Response.json({ access_token: 'winner-access', refresh_token: 'winner-refresh', expires_in: 3600, token_type: 'Bearer' });
  } });
  // Observe failure as well so a regression does not leave a rejected background promise.
  void winner.catch(() => {});
  try {
    await started.promise;
    const inFlight = f.db.rows.get(grantPath);
    await assert.rejects(loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async () => {
      duplicateCalls++;
      // This rejection would previously win the race against the successful response.
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    } }), { code: 'youtube_upload_provider_unavailable' });
    assert.equal(duplicateCalls, 0);
    assert.ok(inFlight?.refreshAttempt);
    assert.equal(await invalidateYouTubeUploadAccessToken(binding, 'upload-access', f.deps), false);
    assert.deepEqual(f.db.rows.get(grantPath), inFlight);
  } finally {
    finish.release();
  }
  assert.equal((await winner).accessToken, 'winner-access');
  assert.equal((await loadYouTubeUploadCredentials(binding, f.deps)).accessToken, 'winner-access');
  assert.equal(f.db.rows.get(grantPath)?.refreshAttempt, null);
  assert.equal((await read(f)).canUpload, true);
});

test('lease kedaluwarsa memerlukan izin ulang sambil menerima hasil konklusif percobaan asli', async () => {
  const f = fixture();
  const { binding } = await approve(f);
  f.advance(3_550_000);
  const stored = f.db.rows.get(grantPath);
  const started = deferred();
  const finish = deferred();
  let duplicateCalls = 0;
  const original = loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async () => {
    started.release();
    await finish.promise;
    return Response.json({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, token_type: 'Bearer' });
  } });
  void original.catch(() => {});
  try {
    await started.promise;
    f.advance(46_000);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async () => {
        duplicateCalls++;
        return new Response(null, { status: 401 });
      } }), { code: 'needs_permission' });
    }
    assert.equal(duplicateCalls, 0);
    const uncertain = f.db.rows.get(grantPath);
    assert.equal((uncertain?.refreshAttempt as { uncertain: boolean })?.uncertain, true);
    assert.equal(uncertain?.permissionInvalidated, undefined);
    assert.equal(uncertain?.encryptedTokens, stored?.encryptedTokens);
    assert.equal((await read(f)).canUpload, false);
  } finally {
    finish.release();
  }
  assert.equal((await original).accessToken, 'late-access');
  assert.equal((await loadYouTubeUploadCredentials(binding, f.deps)).accessToken, 'late-access');
  assert.equal(f.db.rows.get(grantPath)?.refreshAttempt, null);
  assert.equal((await read(f)).canUpload, true);
});

test('hasil terlambat dari lease kedaluwarsa tidak menyentuh grant yang dikonfirmasi ulang', async () => {
  const f = fixture();
  const { binding } = await approve(f);
  f.advance(3_550_000);
  const started = deferred();
  const finish = deferred();
  const original = loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async () => {
    started.release();
    await finish.promise;
    return Response.json({ access_token: 'late-access', refresh_token: 'late-refresh', expires_in: 3600, token_type: 'Bearer' });
  } });
  void original.catch(() => {});
  let replacement: Awaited<ReturnType<typeof approve>> | undefined;
  let record: Row | undefined;
  try {
    await started.promise;
    f.advance(46_000);
    await assert.rejects(loadYouTubeUploadCredentials(binding, f.deps), { code: 'needs_permission' });
    replacement = await approve(f, 1);
    record = f.db.rows.get(grantPath);
  } finally {
    finish.release();
  }
  await assert.rejects(original, { code: 'needs_permission' });
  assert.ok(replacement);
  assert.notEqual(replacement.binding.grantId, binding.grantId);
  assert.deepEqual(f.db.rows.get(grantPath), record);
  assert.equal((await loadYouTubeUploadCredentials(replacement.binding, f.deps)).accessToken, 'upload-access');
});

test('invalid_token, invalid_scope, dan HTTP 401 menandai grant tanpa mengubah kredensial atau koneksi baca', async () => {
  const rejections = [
    Response.json({ error: 'invalid_token' }, { status: 400 }),
    Response.json({ error: 'invalid_scope' }, { status: 400 }),
    new Response(null, { status: 401 }),
  ];
  for (const rejection of rejections) {
    const f = fixture();
    const { binding } = await approve(f);
    const grant = f.db.rows.get(grantPath);
    const readonly = f.db.rows.get(connectionPath);
    const writes = f.db.writes;
    f.advance(3_600_000);
    await assert.rejects(loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async () => rejection }), { code: 'needs_permission' });
    assert.equal(f.db.writes, writes + 2);
    assert.deepEqual(f.db.rows.get(grantPath), { ...grant, permissionInvalidated: true, refreshAttempt: null });
    const dto = await read(f);
    assert.equal(dto.canUpload, false);
    assert.equal(dto.connection?.status, 'connected');
    assert.deepEqual(f.db.rows.get(connectionPath), readonly);
  }
});

test('hasil refresh tidak pasti menjaga ciphertext dan mencegah pengulangan otomatis', async () => {
  const failures: (typeof fetch)[] = [
    async () => new Response(null, { status: 503 }),
    async () => { throw new TypeError('Jaringan fixture terputus.'); },
  ];
  for (const fetcher of failures) {
    const f = fixture();
    const { binding } = await approve(f);
    const grant = f.db.rows.get(grantPath);
    const readonly = f.db.rows.get(connectionPath);
    const writes = f.db.writes;
    f.advance(3_600_000);
    await assert.rejects(loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher }), { code: 'needs_permission' });
    const stored = f.db.rows.get(grantPath);
    assert.equal(stored?.encryptedTokens, grant?.encryptedTokens);
    assert.equal(stored?.permissionInvalidated, undefined);
    assert.equal((stored?.refreshAttempt as { uncertain: boolean })?.uncertain, true);
    assert.equal(f.db.writes, writes + 2);
    assert.equal((await read(f)).canUpload, false);
    assert.deepEqual(f.db.rows.get(connectionPath), readonly);
    f.advance(60_000);
    await assert.rejects(loadYouTubeUploadCredentials(binding, f.deps), { code: 'needs_permission' });
    assert.equal(f.db.writes, writes + 2);
  }
});

test('penolakan refresh grant lama tidak menandai grant pengganti', async () => {
  const f = fixture();
  const { binding } = await approve(f);
  const review = await consent(f, 1);
  f.advance(3_550_000);
  const replacementReview = await consent(f, 2);
  assert.notEqual(replacementReview.authorizationId, review.authorizationId);
  let replacement: Row | undefined;
  let writesAfterConfirm: number | undefined;
  await assert.rejects(loadYouTubeUploadCredentials(binding, { ...f.deps, fetcher: async () => {
    assert.equal((await confirm(f, replacementReview.authorizationId)).status, 200);
    replacement = f.db.rows.get(grantPath);
    writesAfterConfirm = f.db.writes;
    return Response.json({ error: 'invalid_grant' }, { status: 400 });
  } }), { code: 'needs_permission' });
  assert.ok(replacement);
  assert.notEqual(replacement.grantId, binding.grantId);
  assert.equal(replacement.permissionInvalidated, undefined);
  assert.deepEqual(f.db.rows.get(grantPath), replacement);
  assert.equal(f.db.writes, writesAfterConfirm);
  assert.equal((await read(f)).canUpload, true);
  const current = await getYouTubeUploadAccess(request(), workspaceId, businessId, f.deps);
  assert.equal(current.binding.grantId, replacement.grantId);
  assert.equal((await loadYouTubeUploadCredentials(current.binding, f.deps)).accessToken, 'upload-access');
});

test('ciphertext grant tidak dapat dipindahkan ke identitas grant lain', async () => {
  const f = fixture();
  const first = await approve(f);
  const encryptedTokens = f.db.rows.get(grantPath)?.encryptedTokens;
  const second = await approve(f, 1);
  assert.notEqual(second.binding.grantId, first.binding.grantId);
  f.db.rows.set(grantPath, { ...f.db.rows.get(grantPath), encryptedTokens });
  assert.equal((await read(f)).canUpload, false);
  await assert.rejects(loadYouTubeUploadCredentials(second.binding, f.deps));
});
