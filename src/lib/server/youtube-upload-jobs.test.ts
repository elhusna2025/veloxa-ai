import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { GoogleAuth } from 'google-auth-library';
import { blankBusinessProfile } from '../business-context';
import { YOUTUBE_CHUNK_BYTES } from '../youtube-upload-types';
import { ApiError } from './http';
import { YOUTUBE_CALLBACK_PATH, YOUTUBE_READONLY_SCOPE, youtubeConfig, type YouTubeEnv } from './youtube-config';
import { encryptYouTubeTokens } from './youtube-crypto';
import { youtubeProbeSupported } from './youtube-ffprobe';
import { assertSingleYouTubeUploadChannel, assertYouTubeUploadBinding, decryptUploadTokens, encryptUploadTokens, invalidateYouTubeUploadAccessToken, loadYouTubeUploadCredentials, uploadConfigIdentity } from './youtube-upload-auth';
import { tickYouTubeUploads, youtubeUploadAction, youtubeUploadChunk, youtubeUploadCreate, youtubeUploadGet, youtubeUploadsList } from './youtube-upload-jobs';
import { measureYouTubeProbe, probeUploadFile, uploadMedia, type UploadMedia } from './youtube-upload-media';
import { getYouTubeUploadPermission, readYouTubeUploadReviewCredentials } from './youtube-upload-permission';
import { checkedYouTubeSession, openYouTubeSession, sealYouTubeSession, youtubeUploadProvider, YouTubeUploadFailure, type YouTubeUploadProvider } from './youtube-upload-transfer';

type Row = Record<string, unknown>;
class Ref {
  constructor(readonly firestore: Store, readonly path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new Query(this.firestore, `${this.path}/${name}`); }
  async get() {
    const row = this.firestore.rows.get(this.path);
    return { id: this.id, ref: this, exists: row !== undefined, data: () => structuredClone(row) };
  }
}
class Query {
  constructor(readonly store: Store, readonly path: string, readonly sorts?: {
    field: string; low?: string; high?: string; due?: number; limit?: number;
  }) {}
  doc(id: string) { return new Ref(this.store, `${this.path}/${id}`); }
  where(field: string, operation: string, due: number) {
    assert.equal(operation, '<=');
    return new Query(this.store, this.path, { field, due });
  }
  orderBy(field: string) { return new Query(this.store, this.path, { ...this.sorts, field }); }
  startAt(low: string) { return new Query(this.store, this.path, { ...this.sorts!, low }); }
  endAt(high: string) { return new Query(this.store, this.path, { ...this.sorts!, high }); }
  limit(limit: number) { return new Query(this.store, this.path, { ...this.sorts!, limit }); }
  async get() {
    const prefix = this.path + '/';
    let rows = [...this.store.rows].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
    const sorts = this.sorts;
    if (sorts) {
      const key = (row: Row) => row[sorts.field] as string | number;
      rows = rows.filter(([, row]) =>
        (sorts.low === undefined || key(row) >= sorts.low) &&
        (sorts.high === undefined || key(row) <= sorts.high) &&
        (sorts.due === undefined || Number(key(row)) <= sorts.due));
      rows.sort(([, a], [, b]) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
      rows = rows.slice(0, sorts.limit);
    }
    return { docs: await Promise.all(rows.map(([path]) => new Ref(this.store, path).get())) };
  }
}
class Store {
  rows = new Map<string, Row>();
  writes = 0;
  afterTransaction?: (result: unknown) => void;
  private pending: Promise<unknown> = Promise.resolve();
  collection(path: string) { return new Query(this, path); }
  async runTransaction<T>(callback: (transaction: unknown) => Promise<T>) {
    const run = this.pending.then(async () => {
      const effects: Array<() => void> = [];
      const value = await callback({
        get: (ref: Ref | Query) => { assert.equal(effects.length, 0, 'Firestore reads precede writes'); return ref.get(); },
        create: (ref: Ref, data: Row) => effects.push(() => {
          assert.equal(this.rows.has(ref.path), false);
          this.rows.set(ref.path, structuredClone(data));
        }),
        update: (ref: Ref, data: Row) => effects.push(() => {
          assert.equal(this.rows.has(ref.path), true);
          this.rows.set(ref.path, { ...this.rows.get(ref.path), ...structuredClone(data) });
        }),
        set: (ref: Ref, data: Row) => effects.push(() => this.rows.set(ref.path, structuredClone(data))),
        delete: (ref: Ref) => effects.push(() => this.rows.delete(ref.path)),
      });
      for (const effect of effects) effect();
      this.writes += effects.length;
      this.afterTransaction?.(value);
      return value;
    });
    this.pending = run.catch(() => {});
    return run;
  }
}

const workspaceId = 'youtube-upload-test';
const businessId = 'primary';
const scope = { workspaceId, businessId };
const ownerUid = 'owner';
const channelId = 'UC' + 'A'.repeat(22);
const connectionRevision = 'a'.repeat(43);
const grantId = 'g'.repeat(43);
const origin = 'https://veloxa.example.test';
const api = origin + '/api/veloxa/youtube/uploads/';
const session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session';
const encryptionKey = Buffer.alloc(32, 9);
const env = {
  YOUTUBE_OAUTH_ENABLED: 'true', YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS: workspaceId,
  YOUTUBE_REDIRECT_URI: origin + YOUTUBE_CALLBACK_PATH, YOUTUBE_CLIENT_ID: 'fixture.apps.googleusercontent.com',
  YOUTUBE_CLIENT_SECRET: 'fixture-client-secret', YOUTUBE_TOKEN_ENCRYPTION_KEY: encryptionKey.toString('base64'),
};
const config = youtubeConfig(env)!;
const binding = { ...scope, ownerUid, channelId, connectionRevision, grantId };
const knownVideoId = 'fixture1234';
const hash = (input: Buffer) => createHash('sha256').update(input).digest('hex');
const videoResult = (privacy: 'private' | 'public' | 'unlisted' = 'private', processed = false) => ({
  id: knownVideoId, snippet: { channelId }, status: { privacyStatus: privacy, uploadStatus: processed ? 'processed' as const : 'uploaded' as const },
});

function fixture(bytes: Buffer[] = [Buffer.from('fixture media')]) {
  const store = new Store();
  const ref = store.collection('workspaces').doc(workspaceId);
  const workspace = { ownerUid, memberUids: ['member'], snapshotJson: JSON.stringify({ brand: blankBusinessProfile(workspaceId, businessId, 'Bisnis utama') }) };
  store.rows.set(ref.path, workspace);
  store.rows.set(`${ref.path}/private_youtube_connections/${businessId}`, { title: 'Kanal uji' });
  const operationId = randomUUID();
  const variants = { uid: ownerUid, time: 1_800_000_000_000, grant: true, shorts: true };
  const mediaCalls: string[] = [];
  const providerCalls: string[] = [];
  const media: UploadMedia = {
    stage: async (_, index, digest, chunk) => {
      assert.deepEqual(chunk, bytes[index]); assert.equal(digest, hash(chunk));
      mediaCalls.push(`stage:${index}`);
      return `900719925474099${index}`;
    },
    compose: async (_, file, generations) => { mediaCalls.push('compose'); assert.equal(generations.length, file.chunkHashes.length); return '90071992547409999'; },
    measure: async (_, __, generation) => {
      assert.equal(generation, '90071992547409999');
      mediaCalls.push('measure');
      return { durationSeconds: 20, width: variants.shorts ? 720 : 1280, height: variants.shorts ? 1280 : 720, shortsEligible: variants.shorts };
    },
    read: async (_, generation, start, end) => {
      assert.equal(generation, '90071992547409999');
      mediaCalls.push(`read:${start}-${end}`);
      return Buffer.concat(bytes).subarray(start, end + 1);
    },
    cleanup: async () => { mediaCalls.push('cleanup'); },
  };
  const provider: YouTubeUploadProvider = {
      setThumbnail: async () => { throw new Error('Unexpected thumbnail upload'); },
    start: async (_, metadata) => { providerCalls.push('start'); assert.equal(metadata.privacy, 'private'); return session; },
    transfer: async (_, uri, total, __, chunk) => {
      assert.equal(uri, session);
      if (!chunk) { providerCalls.push('status'); return { kind: 'progress', offset: 0 }; }
      providerCalls.push(`bytes:${chunk.start}`);
      assert.equal(chunk.start + chunk.bytes.byteLength, total);
      return { kind: 'complete', video: videoResult() };
    },
    video: async () => { providerCalls.push('video'); return videoResult('private', true); },
  };
  const current = () => {
    if (!variants.grant) throw new ApiError(409, 'Izin berubah.', 'needs_permission');
  };
  const deps = {
    database: store as never, media, provider, config: () => config, now: () => variants.time,
    env: { YOUTUBE_UPLOAD_STORAGE_RETENTION_READY: 'true' } as YouTubeEnv,
    authorize: (async () => ({ ref, user: { uid: variants.uid }, workspace, workspaceId })) as never,
    uploadAccess: (async () => { current(); return { binding, config, ref }; }) as never,
    assertBinding: (async () => current()) as typeof assertYouTubeUploadBinding,
    credentials: (async () => { current(); return { accessToken: 'fixture-token', config }; }) as typeof loadYouTubeUploadCredentials,
    singleChannel: (async () => providerCalls.push('channel')) as never,
    reviewCredentials: (async () => null) as typeof readYouTubeUploadReviewCredentials,
    invalidateCredentials: (async () => false) as typeof invalidateYouTubeUploadAccessToken,
  };
  const source = {
    ...scope, operationId, channelId, connectionRevision, kind: 'short',
    file: { name: 'unggahan.mp4', size: bytes.reduce((size, chunk) => size + chunk.byteLength, 0), mimeType: 'video/mp4', chunkHashes: bytes.map(hash) },
    metadata: { title: 'Video uji', description: '', privacy: 'private', madeForKids: false, containsSyntheticMedia: false },
    confirmed: true,
  };
  const request = (url: string, payload: Row) => new Request(url, { method: 'POST', body: JSON.stringify(payload) });
  const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...scope, ...extra });
  const create = (override: Row = {}) => youtubeUploadCreate(request(api, { ...source, ...override }), deps);
  const read = () => youtubeUploadGet(new Request(`${api}${operationId}/?${query()}`), operationId, deps);
  const list = () => youtubeUploadsList(new Request(`${api}?${query()}`), deps);
  const stage = (index = 0, chunk: Buffer | ReadableStream<Uint8Array> = bytes[index]) =>
    youtubeUploadChunk(new Request(`${api}${operationId}/chunk/?${query({ index: String(index) })}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk as unknown as BodyInit,
      ...(chunk instanceof ReadableStream ? { duplex: 'half' } : {}),
    }), operationId, deps);
  const action = (action: 'process' | 'check' | 'cancel') => youtubeUploadAction(request(`${api}${operationId}/action/`, { ...scope, action }), operationId, deps);
  const tick = () => tickYouTubeUploads({}, deps);
  const raw = () => [...store.rows].find(([path]) => path.startsWith('private_youtube_uploads/'))?.[1];
  const guard = () => store.rows.get(`${ref.path}/youtube_upload_dispatch/${businessId}`);
  return { create, read, list, stage, action, tick, source, variants, provider, mediaCalls, providerCalls, store, raw, guard, deps };
}

function useRealStatusCredentials(f: ReturnType<typeof fixture>, onRefresh?: () => Promise<void>) {
  const ws = `workspaces/${workspaceId}`;
  const grantPath = `${ws}/private_youtube_upload_grants/${businessId}`;
  const configIdentity = uploadConfigIdentity(config);
  const expiresAt = () => f.variants.time + 3_600_000;
  f.store.rows.set(`${ws}/private_youtube_connections/${businessId}`, {
    ...configIdentity, channelId, title: 'Kanal uji', handle: '',
    url: `https://www.youtube.com/channel/${channelId}`, authorizationId: connectionRevision,
    authorizedBy: ownerUid, generation: 1, connectedAt: f.variants.time, accessExpiresAt: expiresAt(),
    scope: YOUTUBE_READONLY_SCOPE, encryptedTokens: encryptYouTubeTokens(
      { accessToken: 'readonly-access', refreshToken: 'readonly-refresh' }, { ...scope, authorizationId: connectionRevision }, config.encryptionKey,
    ),
  });
  const seedGrant = (accessToken: string, id = grantId) => {
    const grantBinding = { ...binding, grantId: id };
    f.store.rows.set(grantPath, {
      ...grantBinding, ...configIdentity, accessExpiresAt: expiresAt(),
      encryptedTokens: encryptUploadTokens({ accessToken, refreshToken: 'fixture-refresh' }, grantBinding, config, 'grant'),
    });
  };
  const seedPending = (accessToken: string) => {
    const authorizationId = 'p'.repeat(43);
    f.store.rows.set(`${ws}/private_youtube_upload_authorizations/${businessId}`, {
      ...scope, ownerUid, channelId, connectionRevision, ...configIdentity,
      authorizationId, generation: 0, accessExpiresAt: expiresAt(), expiresAt: expiresAt(),
      encryptedTokens: encryptUploadTokens(
        { accessToken, refreshToken: 'pending-refresh' }, { ...binding, grantId: authorizationId }, config, 'pending',
      ),
    });
  };
  const refreshes: string[] = [];
  const auth = {
    env, now: f.deps.now, database: f.deps.database, authorize: f.deps.authorize,
    fetcher: (async (input, init) => {
      assert.equal(String(input), 'https://oauth2.googleapis.com/token');
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('grant_type'), 'refresh_token');
      refreshes.push(body.get('refresh_token')!);
      await onRefresh?.();
      return Response.json({ access_token: 'renewed-token', refresh_token: 'renewed-refresh', token_type: 'Bearer', expires_in: 3600 });
    }) as typeof fetch,
  };
  f.deps.assertBinding = assertYouTubeUploadBinding;
  f.deps.reviewCredentials = readYouTubeUploadReviewCredentials;
  f.deps.credentials = (bound, _, rejected, signal) => loadYouTubeUploadCredentials(bound, auth, rejected, signal);
  const invalidations: { grantId: string; token: string }[] = [];
  f.deps.invalidateCredentials = (bound, token) => {
    invalidations.push({ grantId: bound.grantId, token });
    return invalidateYouTubeUploadAccessToken(bound, token, auth);
  };
  const canUpload = async () => {
    const result = await getYouTubeUploadPermission(new Request(`${origin}/upload-permission?${new URLSearchParams(scope)}`), auth);
    assert.equal(result.status, 200);
    return (await result.json()).canUpload;
  };
  return { seedGrant, seedPending, canUpload, refreshes, invalidations, grantPath };
}

async function operation(response: Promise<Response>) {
  const result = await response;
  assert.equal(result.status, 200, await result.clone().text());
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const body = await result.json();
  assert.ok(body.ok);
  assert.equal(JSON.stringify(body).includes('encryptedSession'), false);
  assert.equal(JSON.stringify(body).includes('fixture-token'), false);
  assert.equal(JSON.stringify(body).includes('upload_id='), false);
  assert.equal(JSON.stringify(body).includes(grantId), false);
  return body.operation;
}

test('create is owner-only and idempotent, validates UTF-8 bytes, and GETs make no writes', async () => {
  const f = fixture();
  for (const metadata of [{ ...f.source.metadata, privacy: undefined }, { ...f.source.metadata, title: '>' }, { ...f.source.metadata, description: '😀'.repeat(1251) }]) {
    assert.equal((await f.create({ metadata })).status, 400);
  }
  const first = await operation(f.create());
  assert.equal(first.metadata.privacy, 'private');
  assert.equal(first.state, 'receiving');
  assert.equal((await f.create({ metadata: { ...f.source.metadata, title: 'Changed' } })).status, 409);
  f.variants.grant = false;
  assert.deepEqual(await operation(f.create()), first);
  const writes = f.store.writes;
  assert.deepEqual(await operation(f.read()), first);
  assert.equal((await (await f.list()).json()).operations.length, 1);
  assert.equal(f.store.writes, writes);
  f.variants.uid = 'member';
  assert.equal((await f.read()).status, 403);
  assert.equal((await f.list()).status, 403);
  assert.equal((await f.create()).status, 403);
});

test('new uploads require an explicit storage retention flag before creating durable work', async () => {
  const f = fixture();
  const writes = f.store.writes;
  f.variants.grant = false;
  for (const ready of [undefined, 'false', 'TRUE']) {
    f.deps.env = ready === undefined ? {} : { YOUTUBE_UPLOAD_STORAGE_RETENTION_READY: ready };
    const result = await f.create();
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await result.json(), {
      ok: false, code: 'youtube_upload_storage_not_ready', error: 'Unggah file belum diaktifkan. Hubungi admin workspace.',
    });
    assert.equal(f.store.writes, writes);
    assert.equal(f.raw(), undefined);
    assert.ok(![...f.store.rows.keys()].some(path => path.includes('/youtube_upload_admissions/')));
    assert.deepEqual(f.mediaCalls, []);
    assert.deepEqual(f.providerCalls, []);
  }

  f.deps.env = { YOUTUBE_UPLOAD_STORAGE_RETENTION_READY: 'true' };
  f.variants.grant = true;
  const first = await operation(f.create());
  assert.equal(first.state, 'receiving');
  assert.deepEqual(f.mediaCalls, []);
  assert.deepEqual(f.providerCalls, []);
  const createdWrites = f.store.writes;
  f.deps.env = {};
  assert.deepEqual(await operation(f.create()), first);
  assert.deepEqual(await operation(f.read()), first);
  assert.equal(f.store.writes, createdWrites);
});

test('mismatched chunk bytes never write storage and Shorts eligibility gates provider dispatch', async () => {
  const f = fixture();
  await operation(f.create());
  assert.equal((await f.stage(0, Buffer.from('fixture MEDIA'))).status, 409);
  assert.deepEqual(f.mediaCalls, []);
  assert.equal((await operation(f.stage())).state, 'validating');
  assert.equal((await f.stage(0, Buffer.from('fixture MEDIA'))).status, 409);
  assert.equal((await operation(f.stage())).state, 'validating');
  assert.deepEqual(f.mediaCalls, ['stage:0']);
  f.variants.shorts = false;
  const result = await operation(f.action('process'));
  assert.equal(result.state, 'rejected');
  assert.equal(result.measured.shortsEligible, false);
  assert.deepEqual(f.providerCalls, []);
  assert.equal(f.guard(), undefined);
});

test('a chunk body that finishes at media expiry cannot stage bytes', async () => {
  const f = fixture();
  await operation(f.create());
  const deadline = Number(f.raw()?.expiresAt);
  f.variants.time = deadline - 1;
  let bodyStarted!: () => void;
  let releaseBody!: () => void;
  const started = new Promise<void>(resolve => { bodyStarted = resolve; });
  const release = new Promise<void>(resolve => { releaseBody = resolve; });
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      bodyStarted();
      await release;
      controller.enqueue(Buffer.from('fixture media'));
      controller.close();
    },
  }, { highWaterMark: 0 });

  const pending = f.stage(0, body);
  await started;
  assert.ok(f.raw()?.lease);
  f.variants.time = deadline;
  releaseBody();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.deepEqual(f.mediaCalls, []);
  assert.equal(f.raw()?.lease, null);
});

test('GCS credentials that resolve past the source cutoff cannot dispatch a staging request', async t => {
  const f = fixture();
  await operation(f.create());
  const cutoff = Number(f.raw()?.expiresAt);
  f.variants.time = cutoff - 5_000;
  let sourceTimeout: AbortSignal | undefined;
  f.deps.media.stage = (...args) => {
    sourceTimeout = args[4];
    return uploadMedia.stage(...args);
  };
  const access = t.mock.method(GoogleAuth.prototype, 'getAccessToken', async () => {
    f.variants.time = cutoff;
    assert.equal(sourceTimeout?.aborted, false);
    return 'fixture-token';
  });
  const storageFetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    generation: '9007199254740990', size: String(f.source.file.size),
  }));
  const response = await f.stage();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'youtube_upload_source_expired');
  assert.equal(access.mock.callCount(), 1);
  assert.equal(storageFetch.mock.callCount(), 0);
  assert.equal(sourceTimeout?.aborted, false);
  assert.equal(f.raw()?.lease, null);
});

test('transactions returning at media expiry do not authorize new source I/O', async t => {
  for (const boundary of ['stage', 'compose', 'measure', 'start', 'read', 'final'] as const) await t.test(boundary, async () => {
    const f = fixture();
    await operation(f.create());
    const deadline = Number(f.raw()?.expiresAt);
    f.variants.time = deadline - 1;
    let crossed = false;
    let afterPreparation = false;
    f.store.afterTransaction = result => {
      if (crossed) return;
      const ready = boundary === 'stage' ? Boolean((result as Row | null)?.lease)
        : boundary === 'compose' ? f.store.rows.has('system_operations/youtube_upload_probe')
        : boundary === 'measure' ? Boolean(f.raw()?.sourceGeneration)
        : afterPreparation;
      if (!ready) return;
      if (boundary === 'final') assert.equal(f.raw()?.finalIntent, true);
      f.variants.time = deadline;
      crossed = true;
    };
    if (boundary === 'stage') {
      assert.equal((await f.stage()).status, 409);
      assert.equal(crossed, true);
      assert.deepEqual(f.mediaCalls, []);
      return;
    }
    if (boundary === 'start') {
      f.deps.singleChannel = (async () => {
        f.providerCalls.push('channel');
        afterPreparation = true;
      }) as never;
    }
    if (boundary === 'read') {
      const transfer = f.provider.transfer;
      f.provider.transfer = async (...args) => {
        const result = await transfer(...args);
        afterPreparation = true;
        return result;
      };
    }
    if (boundary === 'final') {
      const read = f.deps.media.read;
      f.deps.media.read = async (...args) => {
        const bytes = await read(...args);
        afterPreparation = true;
        return bytes;
      };
    }

    await operation(f.stage());
    assert.equal((await operation(f.action('process'))).state, 'cancelled');
    assert.equal(crossed, true);
    assert.equal(f.mediaCalls.includes('compose'), boundary !== 'compose');
    assert.equal(f.mediaCalls.includes('measure'), !['compose', 'measure'].includes(boundary));
    assert.equal(f.providerCalls.includes('start'), boundary === 'read' || boundary === 'final');
    assert.equal(f.mediaCalls.some(call => call.startsWith('read:')), boundary === 'final');
    assert.equal(f.providerCalls.some(call => call.startsWith('bytes:')), false);
    assert.equal(f.raw()?.finalIntent, false);
    assert.equal(f.guard(), undefined);
  });
});

test('crossing the media deadline stops new upload requests and preserves an in-flight final receipt', async t => {
  for (const boundary of ['channel', 'status', 'read', 'receipt'] as const) await t.test(boundary, async () => {
    const f = fixture();
    await operation(f.create());
    await operation(f.stage());
    const deadline = Number(f.raw()?.expiresAt);
    f.variants.time = deadline - 1;
    if (boundary === 'channel') {
      f.deps.singleChannel = (async () => {
        f.providerCalls.push('channel');
        f.variants.time = deadline;
      }) as never;
    }
    if (boundary === 'read') {
      const read = f.deps.media.read;
      f.deps.media.read = async (...args) => {
        const bytes = await read(...args);
        f.variants.time = deadline;
        return bytes;
      };
    }
    const transfer = f.provider.transfer;
    f.provider.transfer = async (...args) => {
      const chunk = args[4];
      const result = await transfer(...args);
      if (boundary === 'status' && !chunk) f.variants.time = deadline;
      if (boundary === 'receipt' && chunk) {
        f.variants.time = deadline;
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(args[3].aborted, false);
      }
      return result;
    };

    const result = await operation(f.action('process'));
    assert.equal(result.state, boundary === 'receipt' ? 'ready' : 'cancelled');
    assert.deepEqual(f.providerCalls, [
      'channel',
      ...(boundary === 'channel' ? [] : ['start', 'status']),
      ...(boundary === 'receipt' ? ['bytes:0', 'video'] : []),
    ]);
    assert.equal(f.mediaCalls.some(call => call.startsWith('read:')), boundary === 'read' || boundary === 'receipt');
    assert.equal(f.raw()?.finalIntent, boundary === 'receipt');
    assert.equal(result.video?.id, boundary === 'receipt' ? knownVideoId : undefined);
    assert.equal(f.guard(), undefined);
  });
});

test('scheduler clock prevents new session, read and final requests after their checks return', async t => {
  for (const boundary of ['session fence', 'read fence', 'final fence', 'provider preparation', 'late receipt'] as const) {
    await t.test(boundary, async t => {
      const f = fixture();
      await operation(f.create());
      await operation(f.stage());
      const budget = 8000;
      let elapsed = 0;
      let afterPreparation = false;
      let workerSignal: AbortSignal | undefined;
      const requests: string[] = [];
      t.mock.method(performance, 'now', () => elapsed);
      const passDeadline = () => {
        assert.equal(workerSignal?.aborted, false);
        elapsed = budget;
      };
      f.deps.singleChannel = (async (_token: string, _channel: string, options: { signal: AbortSignal }) => {
        workerSignal = options.signal;
        if (boundary === 'session fence') afterPreparation = true;
      }) as never;
      const read = f.deps.media.read;
      f.deps.media.read = async (...args) => {
        const result = await read(...args);
        if (boundary === 'final fence') afterPreparation = true;
        return result;
      };
      f.store.afterTransaction = () => {
        if (!afterPreparation) return;
        afterPreparation = false;
        if (boundary === 'final fence') assert.equal(f.raw()?.finalIntent, true);
        passDeadline();
      };
      const provider = youtubeUploadProvider(async (_, init) => {
        if (init?.method === 'POST') {
          requests.push('open');
          return new Response(null, { status: 200, headers: { Location: session } });
        }
        assert.equal(init?.method, 'PUT');
        if (!init?.body) {
          requests.push('status');
          if (boundary === 'read fence') afterPreparation = true;
          return new Response(null, { status: 308 });
        }
        requests.push('bytes');
        assert.equal(f.raw()?.finalIntent, true);
        passDeadline();
        return Response.json(videoResult(), { status: 201 });
      });
      Object.assign(f.provider, provider, {
        transfer: async (...args: Parameters<YouTubeUploadProvider['transfer']>) => {
          if (boundary === 'provider preparation' && args[4]) {
            assert.equal(f.raw()?.finalIntent, true);
            passDeadline();
          }
          return provider.transfer(...args);
        },
      });

      assert.equal((await tickYouTubeUploads({ budgetMs: budget }, f.deps)).processed, 1);
      assert.equal(elapsed, budget);
      assert.deepEqual(requests, [
        ...(boundary === 'session fence' ? [] : ['open', 'status']),
        ...(boundary === 'late receipt' ? ['bytes'] : []),
      ]);
      assert.equal(f.mediaCalls.some(call => call.startsWith('read:')), ['final fence', 'provider preparation', 'late receipt'].includes(boundary));
      const result = await operation(f.read());
      if (boundary === 'late receipt') {
        assert.equal(result.state, 'processing');
        assert.equal(result.video.id, knownVideoId);
        assert.equal(f.guard(), undefined);
      } else {
        assert.equal(f.raw()?.finalIntent, false);
        assert.equal(result.video, undefined);
      }
    });
  }
});

test('scheduler clock blocks GCS after ADC and the next channel page even before timer delivery', async t => {
  for (const part of ['storage', 'channel'] as const) await t.test(part, async t => {
    const f = fixture();
    await operation(f.create());
    await operation(f.stage());
    const budget = 8000;
    let elapsed = 0;
    t.mock.method(performance, 'now', () => elapsed);
    if (part === 'storage') {
      let sourceSignal: AbortSignal | undefined;
      f.deps.media.read = (...args) => {
        sourceSignal = args[5];
        return uploadMedia.read(...args);
      };
      const credential = t.mock.method(GoogleAuth.prototype, 'getAccessToken', async () => {
        assert.equal(sourceSignal?.aborted, false);
        elapsed = budget;
        return 'fixture-token';
      });
      const storageFetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('GCS fetch after scheduler cutoff'));
      assert.equal((await tickYouTubeUploads({ budgetMs: budget }, f.deps)).processed, 1);
      assert.equal(credential.mock.callCount(), 1);
      assert.equal(storageFetch.mock.callCount(), 0);
      assert.deepEqual(f.providerCalls, ['channel', 'start', 'status']);
    } else {
      let pages = 0;
      f.deps.singleChannel = ((token: string, id: string, { signal }: { signal: AbortSignal }) =>
        assertSingleYouTubeUploadChannel(token, id, {
          signal,
          fetcher: async () => {
            pages++;
            assert.equal(signal.aborted, false);
            elapsed = budget;
            return Response.json({ items: [{ id }], nextPageToken: 'second-page' });
          },
        })) as never;
      assert.equal((await tickYouTubeUploads({ budgetMs: budget }, f.deps)).processed, 1);
      assert.equal(pages, 1);
      assert.deepEqual(f.providerCalls, []);
    }
    assert.equal(f.raw()?.finalIntent, false);
    assert.equal(elapsed, budget);
  });
});

test('scheduler leaves a slow queue read behind without processing its late result', async t => {
  const f = fixture();
  await operation(f.create());
  await operation(f.stage());
  const writes = f.store.writes;
  const read = Query.prototype.get;
  let markStarted!: () => void;
  let markReturned!: () => void;
  let unblock!: () => void;
  let released = false;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const returned = new Promise<void>(resolve => { markReturned = resolve; });
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  function release() {
    released = true;
    unblock();
  }
  t.mock.method(Query.prototype, 'get', async function (this: Query) {
    assert.equal(this.path, 'private_youtube_uploads');
    markStarted();
    await blocked;
    const result = await read.call(this);
    assert.equal(result.docs.length, 1);
    markReturned();
    return result;
  });
  // The watchdog also lets the test fail cleanly if the scheduler awaits the slow query.
  const watchdog = setTimeout(release, 3000);
  try {
    const tick = tickYouTubeUploads({ budgetMs: 1000 }, f.deps);
    await started;
    assert.deepEqual(await tick, { processed: 0, steps: 0 });
    assert.equal(released, false);
    assert.equal(f.raw()?.state, 'validating');
  } finally {
    clearTimeout(watchdog);
    release();
  }
  await returned;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(f.store.writes, writes);
  assert.deepEqual(f.mediaCalls, ['stage:0']);
  assert.deepEqual(f.providerCalls, []);
});

test('scheduler returns before a late claim and restores that job without starting work', async t => {
  const f = fixture();
  await operation(f.create());
  await operation(f.stage());
  const nextRunAt = f.raw()?.nextRunAt;
  const run = f.store.runTransaction.bind(f.store);
  let markClaimed!: () => void;
  let markCleared!: () => void;
  let unblock!: () => void;
  let released = false;
  let holdClaim = true;
  const claimed = new Promise<void>(resolve => { markClaimed = resolve; });
  const cleared = new Promise<void>(resolve => { markCleared = resolve; });
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  function release() {
    released = true;
    unblock();
  }
  t.mock.method(f.store, 'runTransaction', async <T>(callback: (tx: unknown) => Promise<T>) => {
    const result = await run(callback);
    if (!holdClaim) return result;
    holdClaim = false;
    markClaimed();
    await blocked;
    return result;
  });
  f.store.afterTransaction = () => {
    if (f.raw()?.lease === null) markCleared();
  };
  const watchdog = setTimeout(release, 3000);
  try {
    const tick = tickYouTubeUploads({ budgetMs: 1200 }, f.deps);
    await claimed;
    assert.ok(f.raw()?.lease);
    assert.deepEqual(await tick, { processed: 0, steps: 0 });
    assert.equal(released, false);
  } finally {
    clearTimeout(watchdog);
    release();
  }
  await cleared;
  assert.equal(f.raw()?.state, 'validating');
  assert.equal(f.raw()?.lease, null);
  assert.equal(f.raw()?.nextRunAt, nextRunAt);
  assert.deepEqual(f.mediaCalls, ['stage:0']);
  assert.deepEqual(f.providerCalls, []);
});

test('scheduler timeout clears only an undispatched refresh claim and settles an already sent rotation', async t => {
  for (const outcome of ['unsent', 'replaced', 'expired-lease', 'dispatched'] as const) await t.test(outcome, async t => {
    const f = fixture();
    await operation(f.create());
    await operation(f.stage());
    assert.equal((await operation(f.action('process'))).state, 'processing');
    const before = [...f.providerCalls];
    let markPaused!: () => void;
    let markSettled!: () => void;
    let unblock!: () => void;
    let released = false;
    const paused = new Promise<void>(resolve => { markPaused = resolve; });
    const settled = new Promise<void>(resolve => { markSettled = resolve; });
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    const auth = useRealStatusCredentials(f, outcome === 'dispatched' ? async () => {
      markPaused();
      await blocked;
    } : undefined);
    f.variants.time += 10_000;
    auth.seedGrant('stale-token');
    const original = { ...f.store.rows.get(auth.grantPath)!, accessExpiresAt: f.variants.time };
    f.store.rows.set(auth.grantPath, original);
    if (outcome !== 'dispatched') {
      const run = f.store.runTransaction.bind(f.store);
      t.mock.method(f.store, 'runTransaction', async <T>(callback: (tx: unknown) => Promise<T>) => {
        const result = await run(callback);
        if ((result as Row | null)?.state === 'claimed') {
          markPaused();
          await blocked;
        }
        return result;
      });
    }
    const credentials = f.deps.credentials;
    f.deps.credentials = async (...args) => {
      try { return await credentials(...args); }
      finally { markSettled(); }
    };
    function release() {
      released = true;
      unblock();
    }
    let replacement: Row | undefined;
    const watchdog = setTimeout(release, 3500);
    try {
      const tick = tickYouTubeUploads({ budgetMs: 1200 }, f.deps);
      await paused;
      const claimedAttempt = f.store.rows.get(auth.grantPath)?.refreshAttempt as { expiresAt: number } | undefined;
      assert.ok(claimedAttempt);
      if (outcome === 'expired-lease') {
        f.variants.time = claimedAttempt.expiresAt;
        release();
      }
      await tick;
      assert.equal(released, outcome === 'expired-lease');
      if (outcome === 'replaced') {
        auth.seedGrant('replacement-token', 'q'.repeat(43));
        replacement = structuredClone(f.store.rows.get(auth.grantPath)!);
      }
    } finally {
      clearTimeout(watchdog);
      release();
    }
    await settled;
    const grant = f.store.rows.get(auth.grantPath);
    if (outcome === 'dispatched') {
      assert.deepEqual(auth.refreshes, ['fixture-refresh']);
      assert.equal(grant?.refreshAttempt, null);
      assert.equal(grant?.permissionInvalidated, undefined);
      assert.deepEqual(decryptUploadTokens(String(grant?.encryptedTokens), binding, config, 'grant'), {
        accessToken: 'renewed-token', refreshToken: 'renewed-refresh',
      });
    } else {
      assert.deepEqual(auth.refreshes, []);
      assert.deepEqual(grant, outcome === 'replaced' ? replacement : { ...original, refreshAttempt: null });
    }
    assert.deepEqual(f.providerCalls, before);
  });
});

test('a lost final response is recovered by querying the same stored session, then polling processing', async () => {
  const f = fixture([Buffer.alloc(YOUTUBE_CHUNK_BYTES, 1), Buffer.from('last part')]);
  let offset = 0;
  let accepted = false;
  f.provider.transfer = async (_, uri, total, __, chunk) => {
    assert.equal(uri, session);
    if (!chunk) return accepted ? { kind: 'complete', video: videoResult() } : { kind: 'progress', offset };
    assert.equal(chunk.start, offset);
    offset += chunk.bytes.length;
    if (offset < total) return { kind: 'progress', offset };
    assert.equal(f.raw()?.finalIntent, true, 'durable final intent before outbound provider write');
    assert.equal(f.guard()?.state, 'active');
    assert.ok(f.raw()?.encryptedSession);
    accepted = true;
    throw new YouTubeUploadFailure('retry');
  };
  await operation(f.create());
  await operation(f.stage(1));
  await operation(f.stage(0));
  const uncertain = await operation(f.action('process'));
  assert.equal(uncertain.state, 'retry_wait');
  assert.equal(uncertain.youtubeBytes, YOUTUBE_CHUNK_BYTES);
  assert.notEqual(f.raw()?.encryptedSession, session);
  assert.equal((await f.action('cancel')).status, 409);
  f.variants.time = uncertain.retryAt;
  assert.equal((await f.tick()).processed, 1);
  const processing = await operation(f.read());
  assert.equal(processing.state, 'processing');
  assert.equal(processing.video.id, knownVideoId);
  assert.equal(f.guard(), undefined);
  f.variants.time += 10_000;
  await f.tick();
  const ready = await operation(f.read());
  assert.equal(ready.state, 'ready');
  assert.equal(ready.video.privacy, 'private');
  assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
  f.variants.time += 10_000;
  await f.tick();
  assert.equal(f.mediaCalls.at(-1), 'cleanup');
});

test('cleanup revisits a late GCS stage or compose commit after its first DELETE returned 404', async t => {
  for (const phase of ['stage', 'compose'] as const) await t.test(phase, async () => {
    const f = fixture();
    await operation(f.create());
    const deadline = Number(f.raw()?.expiresAt);
    const objects = new Map<string, string>();
    let latePath = '';
    let commitLate = () => {};
    const deleted: Array<{ path: string; existed: boolean }> = [];
    t.mock.method(GoogleAuth.prototype, 'getAccessToken', async () => 'fixture-storage-token');
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://storage.googleapis.com');
      if (init?.method === 'POST') {
        latePath = phase === 'stage' ? url.searchParams.get('name')!
          : decodeURIComponent(url.pathname.split('/o/')[1]).replace(/\/compose$/, '');
        assert.ok(latePath.startsWith('private-youtube-uploads/'));
        commitLate = () => { objects.set(latePath, '900719925474099123'); };
        // The local request has failed, but this already-dispatched server write can still commit.
        throw new DOMException('Fixture response was lost after dispatch.', 'AbortError');
      }
      assert.equal(init?.method, 'DELETE');
      assert.equal(url.searchParams.has('generation'), false, 'a late live generation is not the old checkpointed generation');
      const path = decodeURIComponent(url.pathname.split('/o/')[1]);
      const existed = objects.delete(path);
      deleted.push({ path, existed });
      return new Response(null, { status: existed ? 204 : 404 });
    });
    f.deps.media.cleanup = uploadMedia.cleanup;
    if (phase === 'stage') {
      f.deps.media.stage = uploadMedia.stage;
      assert.equal((await f.stage()).status, 503);
    } else {
      await operation(f.stage());
      f.deps.media.compose = uploadMedia.compose;
      assert.equal((await operation(f.action('process'))).state, 'retry_wait');
    }
    assert.equal(typeof f.raw()?.mediaWritePending, 'string');
    assert.ok(latePath);
    f.variants.time = deadline;
    await f.tick();
    assert.equal((await operation(f.read())).state, 'cancelled');
    assert.ok(deleted.some(item => item.path === latePath && !item.existed));
    assert.equal(f.raw()?.mediaCleaned, false, '404 is only a sweep while a write is unresolved');
    const recheckAt = Number(f.raw()?.mediaCleanupRecheckAt);
    assert.equal(recheckAt, deadline + 60 * 60_000);
    assert.equal(f.raw()?.nextRunAt, recheckAt);
    const firstSweepCount = deleted.length;
    assert.equal((await f.tick()).processed, 0, 'a future cleanup obligation cannot spin the queue');
    assert.equal(deleted.length, firstSweepCount);
    commitLate();
    assert.equal(objects.size, 1);
    f.variants.time = recheckAt;
    await f.tick();
    assert.equal(objects.size, 0, 'a later sweep deletes the object that appeared after the original 404');
    assert.ok(deleted.some(item => item.path === latePath && item.existed));
    assert.equal(f.raw()?.mediaCleaned, false);
    assert.equal(f.raw()?.mediaCleanupRecheckAt, recheckAt + 60 * 60_000);
    assert.deepEqual(f.providerCalls, []);
    assert.equal(f.raw()?.expiresAt, deadline);
  });
});

test('uncertain GCS cleanup stays independent of final-session cooldown and never clears the dispatch fence', async () => {
  const f = fixture();
  await operation(f.create());
  const normalStage = f.deps.media.stage;
  f.deps.media.stage = async () => { throw new Error('Fixture storage response was lost.'); };
  assert.equal((await f.stage()).status, 503);
  f.deps.media.stage = normalStage;
  await operation(f.stage());
  assert.equal(f.raw()?.mediaWritePending, null);
  assert.equal(f.raw()?.mediaWriteUncertain, true, 'a new known attempt cannot erase a prior unresolved write');
  let statusChecks = 0;
  f.provider.transfer = async (_, uri, __, ___, chunk) => {
    assert.equal(uri, session);
    if (chunk) throw new YouTubeUploadFailure('unauthenticated');
    statusChecks++;
    return { kind: 'progress', offset: 0 };
  };
  f.variants.time = Number(f.raw()?.expiresAt) - 1;
  const review = await operation(f.action('process'));
  assert.equal(review.state, 'needs_review');
  const sealedSession = f.raw()?.encryptedSession;
  const originalCooldown = review.retryAt;
  f.variants.time += 1;
  const cleaned = await operation(f.action('check'));
  assert.equal(cleaned.state, 'needs_review');
  assert.equal(cleaned.retryAt, originalCooldown);
  const recheckAt = Number(f.raw()?.mediaCleanupRecheckAt);
  assert.equal(f.raw()?.mediaCleaned, false);
  assert.equal(f.raw()?.nextRunAt, recheckAt);
  assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 1);
  assert.equal(statusChecks, 1);
  assert.equal(f.guard()?.state, 'unknown');
  assert.equal(f.raw()?.encryptedSession, sealedSession);
  f.variants.time = originalCooldown;
  await operation(f.action('check'));
  assert.equal(statusChecks, 2);
  assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 1);
  assert.equal(f.raw()?.nextRunAt, recheckAt);
  f.variants.time = recheckAt;
  await f.tick();
  assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 2);
  assert.equal(statusChecks, 2);
  assert.equal(f.guard()?.state, 'unknown');
  assert.equal(f.raw()?.encryptedSession, sealedSession);
  assert.equal(f.raw()?.nextRunAt, recheckAt + 60 * 60_000);
});

test('scheduled final-session status retries once after 401 before considering more bytes', async t => {
  for (const outcome of ['accepted', 'revoked', 'partial-then-401'] as const) await t.test(outcome, async () => {
    const f = fixture();
    const auth = useRealStatusCredentials(f);
    auth.seedGrant('stale-token');
    let finalSends = 0;
    f.provider.transfer = async (token, uri, __, ___, chunk) => {
      assert.equal(token, 'stale-token');
      assert.equal(uri, session);
      if (!chunk) return { kind: 'progress', offset: 0 };
      assert.equal(f.raw()?.finalIntent, true);
      finalSends++;
      throw new YouTubeUploadFailure('retry');
    };
    await operation(f.create());
    await operation(f.stage());
    const retry = await operation(f.action('process'));
    assert.equal(retry.state, 'retry_wait');
    assert.equal(finalSends, 1);
    assert.deepEqual(auth.refreshes, []);
    const sealed = f.raw()?.encryptedSession;
    const sent: { token: string | null; range: string | null; length: string | null }[] = [];
    const total = f.source.file.size;
    Object.assign(f.provider, youtubeUploadProvider(async (input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(String(input), session);
      assert.equal(init?.method, 'PUT');
      const range = headers.get('content-range');
      sent.push({ token: headers.get('authorization'), range, length: headers.get('content-length') });
      if (sent.length === 1 || outcome === 'revoked') return new Response(null, { status: 401 });
      if (outcome === 'accepted') {
        assert.equal(init?.body, undefined);
        return Response.json(videoResult());
      }
      if (sent.length === 2) return new Response(null, { status: 308, headers: { Range: 'bytes=0-1' } });
      assert.deepEqual(init?.body, Buffer.from('fixture media').subarray(2));
      return new Response(null, { status: 401 });
    }));

    f.variants.time = retry.retryAt;
    assert.equal((await f.tick()).processed, 1);
    const result = await operation(f.read());
    assert.equal(result.state, outcome === 'accepted' ? 'processing' : 'needs_review');
    assert.equal(result.video?.id, outcome === 'accepted' ? knownVideoId : undefined);
    assert.equal(f.raw()?.encryptedSession, outcome === 'accepted' ? null : sealed);
    assert.equal(f.guard()?.state, outcome === 'accepted' ? undefined : 'unknown');
    assert.deepEqual(sent, [
      { token: 'Bearer stale-token', range: `bytes */${total}`, length: '0' },
      { token: 'Bearer renewed-token', range: `bytes */${total}`, length: '0' },
      ...(outcome === 'partial-then-401'
        ? [{ token: 'Bearer renewed-token', range: `bytes 2-${total - 1}/${total}`, length: String(total - 2) }]
        : []),
    ]);
    assert.deepEqual(auth.refreshes, ['fixture-refresh']);
    assert.deepEqual(auth.invalidations, outcome === 'revoked' ? [{ grantId, token: 'renewed-token' }] : []);
    assert.equal(await auth.canUpload(), outcome !== 'revoked');
    assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
  });
});

test('verified 308 progress after partial final PUT continues the same session from its acknowledged offset', async () => {
  const f = fixture();
  const sends: number[] = [];
  let offset = 0;
  f.provider.transfer = async (_, uri, total, __, chunk) => {
    assert.equal(uri, session);
    if (!chunk) return { kind: 'progress', offset };
    assert.equal(f.raw()?.finalIntent, true);
    assert.equal(chunk.start, offset);
    assert.equal(chunk.bytes.byteLength, total - offset);
    sends.push(chunk.start);
    if (offset === 0) {
      offset = 2;
      return { kind: 'progress', offset };
    }
    return { kind: 'complete', video: videoResult() };
  };
  await operation(f.create());
  await operation(f.stage());
  assert.equal((await operation(f.action('process'))).state, 'processing');
  assert.deepEqual(sends, [0, 2]);
  assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
  assert.equal(f.guard(), undefined);
});

test('media expiry stays scheduled ahead of transfer and session-restart cooldowns', async t => {
  for (const phase of ['final', 'restart'] as const) await t.test(phase, async () => {
    const f = fixture();
    await operation(f.create());
    await operation(f.stage());
    const deadline = Number(f.raw()?.expiresAt);
    f.variants.time = deadline - 1;
    let checks = 0;
    let sends = 0;
    f.provider.transfer = async (_, uri, __, ___, chunk) => {
      assert.equal(uri, session);
      if (chunk) {
        sends++;
        throw new YouTubeUploadFailure('retry');
      }
      checks++;
      if (phase === 'restart') throw new YouTubeUploadFailure('expired');
      return { kind: 'progress', offset: 0 };
    };
    const retry = await operation(f.action('process'));
    assert.equal(retry.state, 'retry_wait');
    assert.ok(retry.retryAt > deadline);
    assert.equal(f.raw()?.nextRunAt, deadline);
    const sealed = f.raw()?.encryptedSession;

    f.variants.time = deadline;
    assert.equal((await f.tick()).processed, 1);
    assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 1);
    assert.equal(checks, 1);
    const expired = await operation(f.read());
    if (phase === 'restart') {
      assert.equal(expired.state, 'cancelled');
      assert.equal(sends, 0);
      assert.equal(f.guard(), undefined);
      return;
    }

    assert.equal(expired.state, 'needs_review');
    assert.equal(expired.retryAt, retry.retryAt);
    assert.equal(f.raw()?.encryptedSession, sealed);
    assert.equal(f.guard()?.state, 'unknown');
    f.variants.time = retry.retryAt - 1;
    assert.equal((await operation(f.action('check'))).state, 'needs_review');
    assert.equal(checks, 1);
    f.variants.time = retry.retryAt;
    assert.equal((await operation(f.action('check'))).state, 'needs_review');
    assert.equal(checks, 2);
    assert.equal(sends, 1);
    assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
    assert.equal(f.raw()?.encryptedSession, sealed);
    assert.equal(f.guard()?.state, 'unknown');
  });
});

test('manual final-session checks only requeue the bound session for a process action', async () => {
  const f = fixture();
  let sends = 0;
  let statusChecks = 0;
  f.provider.transfer = async (_, uri, __, ___, chunk) => {
    assert.equal(uri, session);
    if (!chunk) {
      statusChecks++;
      return { kind: 'progress', offset: sends === 0 ? 0 : 2 };
    }
    sends++;
    if (sends === 1) throw new YouTubeUploadFailure('unauthenticated');
    assert.equal(chunk.start, 2);
    return { kind: 'complete', video: videoResult() };
  };
  await operation(f.create());
  await operation(f.stage());
  const review = await operation(f.action('process'));
  assert.equal(review.state, 'needs_review');
  assert.equal(f.guard()?.state, 'unknown');
  f.variants.time = review.retryAt;
  assert.equal((await f.tick()).processed, 0);
  assert.ok(!f.mediaCalls.includes('cleanup'));
  const resumed = await operation(f.action('check'));
  assert.equal(resumed.state, 'uploading');
  assert.equal(resumed.youtubeBytes, 2);
  assert.equal(f.guard()?.state, 'unknown');
  assert.equal(sends, 1);
  const mediaBefore = [...f.mediaCalls];
  assert.equal((await operation(f.action('check'))).state, 'uploading');
  assert.equal((await operation(f.action('check'))).state, 'uploading');
  assert.equal(statusChecks, 2);
  assert.equal(sends, 1);
  assert.deepEqual(f.mediaCalls, mediaBefore);
  assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
  assert.equal((await operation(f.action('process'))).state, 'processing');
  assert.equal(statusChecks, 3);
  assert.equal(sends, 2);
  assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
});

test('late final-session receipt keeps the media deadline and remains visible through processing', async t => {
  for (const received of ['after media expiry', 'near history expiry'] as const) await t.test(received, async () => {
    const f = fixture();
    let finalSends = 0;
    let videoChecks = 0;
    f.provider.transfer = async (_, uri, __, ___, chunk) => {
      assert.equal(uri, session);
      if (!chunk) return finalSends === 0 ? { kind: 'progress', offset: 0 } : { kind: 'complete', video: videoResult() };
      finalSends++;
      assert.equal(f.raw()?.finalIntent, true);
      throw new YouTubeUploadFailure('unauthenticated');
    };
    f.provider.video = async (_, id) => {
      assert.equal(id, knownVideoId);
      assert.equal(f.raw()?.mediaCleaned, true);
      videoChecks++;
      return videoResult('private', videoChecks === 2);
    };
    await operation(f.create());
    await operation(f.stage());
    const review = await operation(f.action('process'));
    assert.equal(review.state, 'needs_review');
    assert.equal(f.guard()?.state, 'unknown');
    const deadline = Number(f.raw()?.expiresAt);
    const originalHistoryUntil = Number(f.raw()?.historyUntil);
    const receivedAt = received === 'near history expiry' ? originalHistoryUntil - 1 : deadline + 1;
    f.variants.time = receivedAt;

    const recovered = await operation(f.action('check'));
    assert.equal(recovered.state, 'processing');
    assert.equal(recovered.video.id, knownVideoId);
    assert.equal(f.raw()?.expiresAt, deadline);
    assert.equal(f.raw()?.historyUntil, receivedAt + 30 * 24 * 60 * 60_000);
    assert.equal(f.raw()?.mediaCleaned, true);
    assert.equal(f.guard(), undefined);
    assert.equal(videoChecks, 0);

    f.variants.time += 10_000;
    assert.equal((await f.tick()).processed, 1);
    assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 1);
    assert.equal(videoChecks, 1);
    assert.equal((await operation(f.read())).state, 'processing');
    f.variants.time += 60_000;
    assert.equal((await f.tick()).processed, 1);
    const ready = await operation(f.read());
    assert.equal(ready.state, 'ready');
    assert.equal(ready.video.id, knownVideoId);
    assert.equal(ready.video.privacy, 'private');
    assert.deepEqual(ready.metadata, f.source.metadata);
    assert.equal(f.raw()?.expiresAt, deadline);
    assert.equal(f.raw()?.mediaCleaned, true);
    assert.equal(f.guard(), undefined);
    assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 1);
    assert.equal(finalSends, 1);
  });
});

test('an overdue manual check cleans media during the status cooldown and keeps the session fenced', async () => {
  const f = fixture();
  await operation(f.create());
  await operation(f.stage());
  const deadline = Number(f.raw()?.expiresAt);
  f.variants.time = deadline - 1;
  let statusCalls = 0;
  f.provider.transfer = async (_, uri, __, ___, chunk) => {
    assert.equal(uri, session);
    if (chunk) throw new YouTubeUploadFailure('unauthenticated');
    statusCalls++;
    return { kind: 'progress', offset: 0 };
  };
  const review = await operation(f.action('process'));
  assert.equal(review.state, 'needs_review');
  assert.ok(review.retryAt > deadline);
  const sealed = f.raw()?.encryptedSession;
  f.variants.time = deadline;

  assert.equal((await operation(f.action('check'))).state, 'needs_review');
  assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 1);
  assert.equal(statusCalls, 1);
  assert.equal(f.guard()?.state, 'unknown');
  assert.equal(f.raw()?.encryptedSession, sealed);
  f.variants.time = review.retryAt;
  assert.equal((await operation(f.action('check'))).state, 'needs_review');
  assert.equal(statusCalls, 2);
  assert.equal(f.mediaCalls.filter(call => call === 'cleanup').length, 1);
  assert.equal(f.guard()?.state, 'unknown');
  assert.equal(f.raw()?.encryptedSession, sealed);
});

test('pre-final 401 forces one refresh and only invalidates the second rejected token', async () => {
  for (const rejectRenewed of [false, true]) {
    const f = fixture();
    let refreshed = false;
    const starts: string[] = [];
    const invalidated: string[] = [];
    const config = f.deps.config();
    f.deps.credentials = (async (_binding: unknown, _deps: unknown, rejected?: string) => {
      if (rejected !== undefined) {
        assert.equal(rejected, 'fixture-token');
        assert.equal(refreshed, false);
        refreshed = true;
      }
      return { accessToken: refreshed ? 'replacement-token' : 'fixture-token', config };
    }) as never;
    f.deps.invalidateCredentials = async (_binding: unknown, token: string) => {
      invalidated.push(token);
      return true;
    };
    f.provider.start = async token => {
      starts.push(token);
      if (token === 'fixture-token' || rejectRenewed) throw new YouTubeUploadFailure('unauthenticated');
      return session;
    };
    await operation(f.create());
    await operation(f.stage());
    assert.equal((await operation(f.action('process'))).state, rejectRenewed ? 'needs_permission' : 'processing');
    assert.deepEqual(starts, ['fixture-token', 'replacement-token']);
    assert.deepEqual(invalidated, rejectRenewed ? ['replacement-token'] : []);
    assert.equal(f.guard(), undefined);
  }
});

test('known video status retries the approved replacement once and invalidates only its rejected token', async t => {
  for (const outcome of ['ready', 'revoked', 'rotated', 'replaced', 'replaced-before-retry'] as const) await t.test(outcome, async () => {
    const f = fixture();
    await operation(f.create());
    await operation(f.stage());
    assert.equal((await operation(f.action('process'))).state, 'processing');
    const auth = useRealStatusCredentials(f);
    const approvedId = 'r'.repeat(43);
    auth.seedGrant('stale-token', approvedId);
    assert.equal(await auth.canUpload(), true);
    if (outcome === 'replaced-before-retry') {
      const load = f.deps.credentials;
      f.deps.credentials = async (...args) => {
        const credentials = await load(...args);
        if (args[2]) auth.seedGrant('replacement-token', 'n'.repeat(43));
        return credentials;
      };
    }
    const sent: string[] = [];
    const provider = youtubeUploadProvider(async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/videos');
      assert.equal(url.searchParams.get('id'), knownVideoId);
      assert.equal(init?.method ?? 'GET', 'GET');
      assert.equal(init?.body, undefined);
      sent.push(new Headers(init?.headers).get('authorization')!);
      if (sent.length === 1) return new Response(null, { status: 401 });
      if (outcome === 'ready') return Response.json({ items: [videoResult('private', true)] });
      if (outcome === 'rotated') auth.seedGrant('newer-token', approvedId);
      if (outcome === 'replaced') auth.seedGrant('renewed-token', 'n'.repeat(43));
      return new Response(null, { status: 401 });
    });
    Object.assign(f.provider, provider);

    f.variants.time += 10_000;
    const result = await operation(f.action('process'));
    assert.equal(result.state, outcome === 'ready' ? 'ready' : 'needs_review');
    assert.equal(result.video.id, knownVideoId);
    assert.deepEqual(sent, outcome === 'replaced-before-retry' ? ['Bearer stale-token'] : ['Bearer stale-token', 'Bearer renewed-token']);
    assert.deepEqual(auth.refreshes, ['fixture-refresh']);
    const repeated401 = outcome === 'revoked' || outcome === 'rotated' || outcome === 'replaced';
    assert.deepEqual(auth.invalidations, repeated401 ? [{ grantId: approvedId, token: 'renewed-token' }] : []);
    assert.equal(await auth.canUpload(), outcome !== 'revoked');
    assert.equal(f.store.rows.get(auth.grantPath)?.permissionInvalidated, outcome === 'revoked' ? true : undefined);
    assert.deepEqual(f.raw()?.binding, binding);
  });
});

test('final session status refresh uses only empty requests to the same URI and preserves the review fence on failure', async t => {
  for (const outcome of ['reconciled', 'revoked', 'pending'] as const) await t.test(outcome, async () => {
    const f = fixture();
    let sends = 0;
    f.provider.transfer = async (_, uri, __, ___, chunk) => {
      assert.equal(uri, session);
      if (!chunk) return { kind: 'progress', offset: 0 };
      sends++;
      assert.equal(f.raw()?.finalIntent, true);
      throw new YouTubeUploadFailure('unauthenticated');
    };
    await operation(f.create());
    await operation(f.stage());
    const review = await operation(f.action('process'));
    assert.equal(review.state, 'needs_review');
    assert.equal(f.guard()?.state, 'unknown');
    const sealed = f.raw()?.encryptedSession;
    const beforeCheck = [...f.mediaCalls];
    const auth = useRealStatusCredentials(f);
    auth.seedGrant('stale-token');
    if (outcome === 'pending') auth.seedPending('pending-token');
    assert.equal(await auth.canUpload(), true);
    const sent: string[] = [];
    Object.assign(f.provider, youtubeUploadProvider(async (input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(String(input), session);
      assert.equal(init?.method, 'PUT');
      assert.equal(headers.get('content-range'), `bytes */${f.source.file.size}`);
      assert.equal(headers.get('content-length'), '0');
      assert.equal(init?.body, undefined);
      sent.push(headers.get('authorization')!);
      if (sent.length === 2 && outcome === 'reconciled') return Response.json(videoResult());
      return new Response(null, { status: 401 });
    }));

    f.variants.time = review.retryAt;
    const result = await operation(f.action('check'));
    assert.equal(result.state, outcome === 'reconciled' ? 'processing' : 'needs_review');
    assert.equal(result.video?.id, outcome === 'reconciled' ? knownVideoId : undefined);
    assert.equal(f.raw()?.encryptedSession, outcome === 'reconciled' ? null : sealed);
    assert.equal(f.guard()?.state, outcome === 'reconciled' ? undefined : 'unknown');
    assert.deepEqual(sent, outcome === 'pending' ? ['Bearer pending-token'] : ['Bearer stale-token', 'Bearer renewed-token']);
    assert.deepEqual(auth.refreshes, outcome === 'pending' ? [] : ['fixture-refresh']);
    assert.deepEqual(auth.invalidations, outcome === 'revoked' ? [{ grantId, token: 'renewed-token' }] : []);
    assert.equal(await auth.canUpload(), outcome !== 'revoked');
    assert.deepEqual(f.mediaCalls, beforeCheck);
    assert.equal(sends, 1);
    assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
  });
});

test('expired final session keeps a review fence and cannot resubmit the upload', async () => {
  const f = fixture();
  let sentFinal = false;
  let sendCount = 0;
  f.provider.transfer = async (_, uri, __, ___, chunk) => {
    assert.equal(uri, session);
    if (!chunk && !sentFinal) return { kind: 'progress', offset: 0 };
    if (!chunk) throw new YouTubeUploadFailure('expired');
    sendCount += 1;
    sentFinal = true;
    throw new YouTubeUploadFailure('retry');
  };
  await operation(f.create());
  await operation(f.stage());
  const pending = await operation(f.action('process'));
  f.variants.time = pending.retryAt;
  const unresolved = await operation(f.action('process'));
  assert.equal(unresolved.state, 'needs_review');
  assert.equal(f.guard()?.state, 'unknown');
  const fresh = await f.create({ operationId: randomUUID() });
  assert.equal(fresh.status, 409);
  assert.equal((await f.action('cancel')).status, 409);
  f.variants.time = unresolved.retryAt;
  assert.equal((await operation(f.action('check'))).state, 'needs_review');
  assert.equal(f.providerCalls.filter(call => call === 'start').length, 1);
  assert.equal(sendCount, 1);
});

test('provider-confirmed processing with an unexpected privacy setting stays in review', async () => {
  const f = fixture();
  await operation(f.create());
  await operation(f.stage());
  assert.equal((await operation(f.action('process'))).state, 'processing');
  f.provider.video = async () => videoResult('public', true);
  f.variants.time += 10_000;
  const result = await operation(f.action('process'));
  assert.equal(result.state, 'needs_review');
  assert.equal(result.metadata.privacy, 'private');
  assert.equal(result.video.privacy, 'public');
});

test('revoked grant before dispatch leaves the staged operation visible and cancellable', async () => {
  const f = fixture();
  await operation(f.create());
  await operation(f.stage());
  f.variants.grant = false;
  const result = await operation(f.action('process'));
  assert.equal(result.state, 'needs_permission');
  assert.deepEqual(f.providerCalls, []);
  assert.equal((await operation(f.action('cancel'))).state, 'cancelled');
});

test('owner and scheduler cannot dispatch concurrently under the same job lease', async () => {
  const f = fixture();
  await operation(f.create());
  await operation(f.stage());
  let release!: () => void;
  let started!: () => void;
  const block = new Promise<void>(resolve => { release = resolve; });
  const inFlight = new Promise<void>(resolve => { started = resolve; });
  const start = f.provider.start;
  f.provider.start = async (...args) => {
    started();
    await block;
    return start(...args);
  };
  const call = f.action('process');
  await inFlight;
  assert.equal(f.guard()?.state, 'active');
  assert.equal((await f.tick()).processed, 0);
  assert.equal((await operation(f.action('process'))).state, 'queued');
  assert.equal((await f.action('cancel')).status, 409);
  release();
  assert.equal((await operation(call)).state, 'processing');
  assert.equal(f.providerCalls.filter(item => item === 'start').length, 1);
});

test('probe uses rotation, sample aspect, and actual duration, excluding attached image streams', () => {
  const stream = { codec_type: 'video', width: 1920, height: 1080, sample_aspect_ratio: '1:1' };
  const cover = { codec_type: 'video', width: 120, height: 120, disposition: { attached_pic: 1 } };
  const measure = (video: Row, duration = '180.0') => measureYouTubeProbe({ format: { duration }, streams: [cover, video] });
  assert.equal(measure(stream).shortsEligible, false);
  assert.equal(measure({ ...stream, side_data_list: [{ rotation: -90 }] }).shortsEligible, true);
  assert.equal(measure({ ...stream, side_data_list: [{ rotation: -90 }] }, '180.001').shortsEligible, false);
  assert.equal(measure({ ...stream, sample_aspect_ratio: '1:2' }).shortsEligible, true);
  assert.throws(() => measureYouTubeProbe({ format: { duration: '2' }, streams: [cover] }), /video tidak dapat divalidasi/);
});

test('pinned FFprobe reads an actual rotated MP4 without walking its frames', { skip: !youtubeProbeSupported() }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veloxa-probe-fixture-'));
  try {
    const original = join(directory, 'original.mp4');
    const rotated = join(directory, 'rotated.mp4');
    execFileSync(ffmpeg.path, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=240x320:r=24:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', original], { timeout: 8_000 });
    execFileSync(ffmpeg.path, ['-v', 'error', '-i', original, '-c', 'copy', '-metadata:s:v:0', 'rotate=90', rotated], { timeout: 8_000 });
    assert.deepEqual(await probeUploadFile(original, 'video/mp4', AbortSignal.timeout(8000)), {
      durationSeconds: 1, width: 240, height: 320, shortsEligible: true,
    });
    assert.deepEqual(await probeUploadFile(rotated, 'video/mp4', AbortSignal.timeout(8000)), {
      durationSeconds: 1, width: 320, height: 240, shortsEligible: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('provider API supplies explicit privacy and audience, validates resumption offsets and confines its session URL', async () => {
  const requests: { url: URL; init: RequestInit }[] = [];
  const provider = youtubeUploadProvider(async (input, init) => {
    requests.push({ url: new URL(String(input)), init: init! });
    if (requests.length === 1) return new Response(null, { status: 200, headers: { Location: session } });
    return new Response(null, { status: 308, headers: { Range: 'bytes=0-209' } });
  });
  const signal = AbortSignal.timeout(2000);
  await provider.start('test-token', {
    title: 'Uji', description: '', privacy: 'private', madeForKids: false, containsSyntheticMedia: true,
  }, { mimeType: 'video/mp4', size: 300 }, signal);
  const metadata = JSON.parse(String(requests[0].init.body));
  assert.deepEqual(metadata.status, { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  assert.equal(requests[0].url.searchParams.get('notifySubscribers'), 'false');
  assert.deepEqual(await provider.transfer('test-token', session, 300, signal), { kind: 'progress', offset: 210 });
  assert.equal(new Headers(requests[1].init.headers).get('content-range'), 'bytes */300');
  assert.equal(requests[1].init.redirect, 'manual');
  await assert.rejects(provider.transfer('test-token', 'https://www.googleapis.com.evil.test/upload/youtube/v3/videos?upload_id=a', 300, signal));
  assert.equal(requests.length, 2);
  const encrypted = sealYouTubeSession(session, 'job-A', encryptionKey);
  assert.equal(openYouTubeSession(encrypted, 'job-A', encryptionKey), session);
  assert.throws(() => openYouTubeSession(encrypted, 'job-B', encryptionKey));
  assert.throws(() => checkedYouTubeSession(session + '&upload_id=another'));
});

test('server cancellation capability includes partial nonfinal uploads and rejects leased or final delivery', async () => {
  const partial = fixture([Buffer.alloc(YOUTUBE_CHUNK_BYTES, 1), Buffer.from('last')]);
  await operation(partial.create());
  Object.assign(partial.raw()!, { state: 'uploading', youtubeBytes: YOUTUBE_CHUNK_BYTES, lease: null, finalIntent: false });
  assert.equal((await operation(partial.read())).canCancel, true);
  assert.equal((await operation(partial.action('cancel'))).state, 'cancelled');
  for (const blocked of [
    { finalIntent: true },
    { lease: { id: 'active-worker', until: partial.variants.time + 90_000 } },
    { video: { id: knownVideoId, privacy: 'private', processingStatus: 'processing', url: 'https://www.youtube.com/watch?v=' + knownVideoId } },
  ]) {
    const f = fixture(); await operation(f.create());
    Object.assign(f.raw()!, { state: 'uploading', youtubeBytes: 1, ...blocked });
    assert.equal((await operation(f.read())).canCancel, false);
    assert.equal((await f.action('cancel')).status, 409);
  }
});

test('reusing a purged operation UUID gets a new media admission namespace', async () => {
  const f = fixture(); await operation(f.create());
  const firstNamespace = String(f.raw()!.mediaNamespace);
  const path = [...f.store.rows.keys()].find(key => key.startsWith('private_youtube_uploads/'))!;
  const oldBytes = Buffer.from('fixture media');
  const newBytes = Buffer.alloc(oldBytes.length, 2);
  const sourceObjects = new Map<string, Buffer>([[firstNamespace, oldBytes]]);
  f.store.rows.delete(path);
  await operation(f.create({ file: { ...f.source.file, name: 'replacement.mp4', chunkHashes: [hash(newBytes)] } }));
  const secondNamespace = String(f.raw()!.mediaNamespace);
  assert.notEqual(secondNamespace, firstNamespace);
  f.deps.media.stage = async (key, _, digest, bytes) => {
    assert.equal(key, secondNamespace); assert.equal(digest, hash(newBytes)); assert.deepEqual(bytes, newBytes);
    sourceObjects.set(key + ':chunk', bytes); return '9007199254740990';
  };
  f.deps.media.compose = async key => {
    if (!sourceObjects.has(key)) sourceObjects.set(key, sourceObjects.get(key + ':chunk')!);
    return '90071992547409999';
  };
  f.deps.media.measure = async key => {
    assert.equal(key, secondNamespace); return { durationSeconds: 5, width: 720, height: 1280, shortsEligible: true };
  };
  f.deps.media.read = async (key, _, start, end) => sourceObjects.get(key)!.subarray(start, end + 1);
  f.provider.transfer = async (_, __, ___, ____, chunk) => {
    if (!chunk) return { kind: 'progress', offset: 0 };
    assert.deepEqual(chunk.bytes, newBytes);
    return { kind: 'complete', video: videoResult() };
  };
  await operation(f.stage(0, newBytes));
  assert.equal((await operation(f.action('process'))).video.id, knownVideoId);
  assert.deepEqual(sourceObjects.get(firstNamespace), oldBytes);
});

test('failed GCS cleanup does not block due YouTube reconciliation or consume provider attempts', async () => {
  const f = fixture(); await operation(f.create()); await operation(f.stage());
  f.provider.transfer = async (_, __, ___, ____, chunk) => {
    if (chunk) throw new YouTubeUploadFailure('permission');
    return { kind: 'progress', offset: 0 };
  };
  assert.equal((await operation(f.action('process'))).state, 'needs_review');
  const attempts = f.raw()!.attempts;
  f.variants.time = Number(f.raw()!.expiresAt) + 1;
  let cleanupFailures = 0; let statusChecks = 0;
  f.deps.media.cleanup = async () => { cleanupFailures++; throw new Error('fixture GCS outage'); };
  f.provider.transfer = async (_, __, ___, ____, chunk) => {
    assert.equal(chunk, undefined); statusChecks++;
    assert.equal(f.raw()!.attempts, attempts);
    return { kind: 'complete', video: videoResult() };
  };
  const receipt = await operation(f.action('check'));
  assert.equal(receipt.video.id, knownVideoId);
  assert.equal(cleanupFailures, 1); assert.equal(statusChecks, 1); assert.equal(f.guard(), undefined);
  f.variants.time = Number(f.raw()!.mediaCleanupRecheckAt) + 1;
  f.provider.video = async () => { statusChecks++; return videoResult('private', true); };
  const processed = await operation(f.action('check'));
  assert.equal(processed.state, 'ready'); assert.equal(cleanupFailures, 2); assert.equal(statusChecks, 2);
});

test('old uncertain final delivery becomes a private minimal tombstone and can still reconcile', async () => {
  const f = fixture();
  const privateText = 'PRIVATE TITLE AND DESCRIPTION';
  await operation(f.create({ metadata: { ...f.source.metadata, title: privateText, description: privateText }, file: { ...f.source.file, name: 'private-original.mp4' } }));
  await operation(f.stage());
  f.provider.transfer = async (_, __, ___, ____, chunk) => {
    if (chunk) throw new YouTubeUploadFailure('permission');
    return { kind: 'progress', offset: 0 };
  };
  await operation(f.action('process'));
  f.variants.time = Number(f.raw()!.historyUntil) + 1;
  await f.tick();
  const raw = f.raw()!;
  assert.equal(raw.reconciliationOnly, true);
  for (const field of ['metadata', 'file', 'chunks', 'measured', 'sourceGeneration', 'mediaNamespace', 'channelTitle']) assert.equal(Object.hasOwn(raw, field), false, field);
  assert.equal(JSON.stringify(raw).includes(privateText), false);
  assert.equal(JSON.stringify(raw).includes('private-original.mp4'), false);
  const redacted = await operation(f.read());
  assert.equal(redacted.reconciliationOnly, true); assert.equal(redacted.canCancel, false);
  assert.equal(JSON.stringify(redacted).includes(privateText), false);
  f.provider.transfer = async (_, uri, total, __, chunk) => {
    assert.equal(uri, session); assert.equal(total, f.source.file.size); assert.equal(chunk, undefined);
    return { kind: 'complete', video: videoResult() };
  };
  const receipt = await operation(f.action('check'));
  assert.equal(receipt.video.id, knownVideoId); assert.equal(f.guard(), undefined);
  assert.equal(Object.hasOwn(f.raw()!, 'metadata'), false);
});
