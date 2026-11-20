import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { BRAND_PRESETS, generateBrandContentDraft } from '../veloxa-engine';
import type { ContentAgentParams } from './content-agent';
import { ApiError } from './http';
import { scheduledGenerationCheckpoint, sweepExpiredScheduledCheckpoints } from './scheduled-generation-checkpoint';
import { REELS_VOICE_MODEL } from './reels-voice';

async function fixture() {
  let row: Record<string, any> = {}, active = true;
  const files = new Map<string, Buffer>();
  const metadata = new Map<string, Record<string, any>>();
  let generation = 0;
  const put = (path: string, bytes: Buffer, values: Record<string, unknown> = {}, objectTime = Date.now()) => {
    files.set(path, Buffer.from(bytes));
    metadata.set(path, { ...values, generation: String(++generation),
      timeCreated: new Date(objectTime).toISOString(), updated: new Date(objectTime).toISOString() });
  };
  const job = { id: 'slot_1795183200000', path: 'auto_content_rules/rule-a/jobs/slot_1795183200000', get: async () => ({ data: () => structuredClone(row) }) };
  const assertActive = async () => { if (!active) throw new ApiError(409, 'Lease changed'); };
  const update = async (values: Record<string, unknown>) => { await assertActive(); row = { ...row, ...structuredClone(values) }; };
  const bucket = {
    file: (path: string) => ({
      name: path,
      download: async () => { const bytes = files.get(path); if (!bytes) throw Object.assign(new Error('Absent'), { code: 404 }); return [Buffer.from(bytes)]; },
      getMetadata: async () => [structuredClone(metadata.get(path) || {})],
      save: async (bytes: Buffer, options: { metadata?: Record<string, unknown> } = {}) => { put(path, bytes, options.metadata); },
      delete: async (options: { ifGenerationMatch?: string | number } = {}) => {
        if (options.ifGenerationMatch !== undefined && String(options.ifGenerationMatch) !== metadata.get(path)?.generation) {
          throw Object.assign(new Error('Object replaced'), { code: 412 });
        }
        files.delete(path); metadata.delete(path);
      },
    }),
    getFiles: async ({ prefix, endOffset, startOffset, maxResults = 128 }: { prefix: string; endOffset?: string; startOffset?: string; maxResults?: number; autoPaginate?: boolean }) => [[...files.keys()]
      .filter(path => path.startsWith(prefix) && (!endOffset || path < endOffset) && (!startOffset || path >= startOffset))
      .sort().slice(0, maxResults).map(path => bucket.file(path))],
  };
  const params: ContentAgentParams = {
    brand: { ...BRAND_PRESETS.cafe_fnb, workspaceId: 'workspace-a' },
    source: 'autonomous_agent', format: 'carousel', customTopic: 'Layanan bisnis', vaultAssets: [],
    connections: [{ connectionId: 'instagram_200', accountId: '200', channel: 'instagram', loginProvider: 'instagram', accountName: 'Bisnis', handle: '@bisnis', connected: true, followerCount: 0, oauthMode: 'direct_publish', tokenExpiresAt: null, lastPublishedAt: null }],
    planId: 'free_trial',
  };
  const image = await sharp({ create: { width: 100, height: 120, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const make = (providers: Parameters<typeof scheduledGenerationCheckpoint>[5] = {}, settings = {}) =>
    scheduledGenerationCheckpoint('workspace-a', job as never, assertActive, update, () => bucket as never, providers, { storageBudgetMs: 100, ...settings });
  const imageParams = { businessName: 'Bisnis', title: 'Judul', hook: 'Isi singkat', cta: '' };
  return { make, job, files, metadata, put, bucket, params, image, imageParams, row: () => row, set: update, stop: () => { active = false; } };
}

test('scheduled recovery reuses its script, image and completed reviews across invocations', async () => {
  const f = await fixture(); let scripts = 0, images = 0, reviews = 0, facts = 0;
  const providers = {
    generate: (async (params: ContentAgentParams) => { scripts++; return { draft: generateBrandContentDraft(params), engineMode: 'deterministic_local' }; }) as never,
    renderImage: (async () => { images++; return f.image; }) as never,
    verifyScript: (async () => { facts++; }) as never,
    verifyArtwork: (async () => { reviews++; if (reviews < 3) throw new ApiError(503, 'Temporarily unavailable', 'scheduled_artwork_review_unavailable'); }) as never,
  };
  const first = f.make(providers); const generated = await first.generate(f.params);
  const script = { draft: generated.draft, brand: f.params.brand };
  await first.verifyScript(script); const image = await first.renderImage(f.imageParams);
  await assert.rejects(first.verifyArtwork(image, f.imageParams), { status: 503 });
  const next = f.make(providers);
  assert.deepEqual(await next.generate({ ...f.params, connections: f.params.connections.map(account => ({ ...account, lastPublishedAt: '2026-11-21T00:00:00Z', followerCount: 25, tokenExpiresAt: '2027-01-01T00:00:00Z' })) }), JSON.parse(JSON.stringify(generated)));
  await next.verifyScript(script); assert.deepEqual(await next.renderImage(f.imageParams), image);
  await assert.rejects(next.verifyArtwork(image, f.imageParams), { status: 503 });
  await next.verifyArtwork(image, f.imageParams);
  await f.make(providers).verifyArtwork(image, f.imageParams);
  assert.deepEqual({ scripts, images, reviews, facts }, { scripts: 1, images: 1, reviews: 3, facts: 1 });
  assert.ok([...f.files.keys()].every(path => path.startsWith('private_autonomy_checkpoints/') && !path.includes('token=')));
  // Neither another target identity nor another actual frame can inherit an approval.
  await assert.rejects(next.generate({ ...f.params, connections: [{ ...f.params.connections[0], accountId: '999' }] }), { code: 'profile_conflict' });
  await next.verifyArtwork(Buffer.concat([image, Buffer.from('changed')]), f.imageParams);
  assert.equal(reviews, 4);
});

test('a definite rejection replaces only its candidate and a rejected script is regenerated', async () => {
  const f = await fixture(); let images = 0, scripts = 0, reject = true;
  const checkpoint = f.make({
    renderImage: (async () => { images++; return f.image; }) as never,
    generate: (async (params: ContentAgentParams) => { scripts++; return { draft: generateBrandContentDraft(params), engineMode: 'deterministic_local' }; }) as never,
    verifyScript: (async () => { if (reject) throw new ApiError(422, 'Unsupported claim', 'scheduled_script_rejected'); }) as never,
  });
  await checkpoint.renderImage(f.imageParams); await checkpoint.renderImage({ ...f.imageParams, title: 'Lain' });
  await checkpoint.artworkRepair.save(0, { kind: 'layout', description: 'Keep the headline away from the face.' });
  await checkpoint.invalidateImage(f.imageParams);
  await checkpoint.renderImage(f.imageParams); await checkpoint.renderImage({ ...f.imageParams, title: 'Lain' });
  assert.equal(images, 3);
  assert.equal((await checkpoint.artworkRepair.load(0))?.kind, 'layout');
  const generated = await checkpoint.generate(f.params);
  await assert.rejects(checkpoint.verifyScript({ draft: generated.draft, brand: f.params.brand }), { code: 'scheduled_script_rejected' });
  reject = false; const rebuilt = await checkpoint.generate(f.params);
  await checkpoint.verifyScript({ draft: rebuilt.draft, brand: f.params.brand });
  assert.equal(scripts, 2);
});

test('stale workers and an unknown paid session cannot regenerate or approve content', async () => {
  const f = await fixture(); let calls = 0;
  const checkpoint = f.make({ generate: (async () => { calls++; assert.fail('must not create another session'); }) as never });
  await f.set({ scriptCreationStarted: true });
  await assert.rejects(checkpoint.generate(f.params), { code: 'content_agent_creation_uncertain' });
  assert.equal(calls, 0); f.stop();
  await assert.rejects(checkpoint.renderImage(f.imageParams), { status: 409 });
  await assert.rejects(checkpoint.verifyArtwork(f.image, f.imageParams), { status: 409 });
  assert.equal(f.files.size, 0);
});

test('cached Reels audio preserves timing and rejects corrupt model, timing or PCM bounds', async () => {
  const f = await fixture(); let voices = 0;
  const source = { sceneLines: ['Satu', 'Dua', 'Tiga', 'Empat'], model: REELS_VOICE_MODEL };
  const voice = () => { voices++; return Promise.resolve({ pcm: Buffer.alloc(48_000), sampleRate: 24000 as const, model: REELS_VOICE_MODEL, sceneDurations: [.25, .25, .25, .25] }); };
  const checkpoint = f.make(); await checkpoint.voice(source, voice); await checkpoint.voice(source, voice);
  assert.equal(voices, 1);
  const path = [...f.files.keys()].find(path => path.endsWith('.bin'))!;
  for (const kind of ['model', 'timing', 'pcm']) {
    const bytes = f.files.get(path)!; const size = bytes.readUInt32LE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + size).toString());
    if (kind === 'model') header.model = 'different-model';
    if (kind === 'timing') header.sceneDurations = [1, 1, 1, 1];
    const metadata = Buffer.from(JSON.stringify(header)); const length = Buffer.alloc(4); length.writeUInt32LE(metadata.length);
    f.files.set(path, Buffer.concat([length, metadata, kind === 'pcm' ? Buffer.alloc(4_320_002) : bytes.subarray(4 + size)]));
    await checkpoint.voice(source, voice);
  }
  assert.equal(voices, 4);
});

test('checkpoint storage stalls yield a resumable error and cleanup remains bounded', async () => {
  const f = await fixture(); const never = () => new Promise<never>(() => {}); let renders = 0;
  const bucket = { file: () => ({ download: never }), getFiles: never };
  const checkpoint = scheduledGenerationCheckpoint('workspace-a', f.job as never, async () => {}, async () => {}, () => bucket as never,
    { renderImage: (async () => { renders++; return f.image; }) as never }, { storageBudgetMs: 5 });
  await assert.rejects(checkpoint.renderImage(f.imageParams), { code: 'scheduled_checkpoint_unavailable' });
  await checkpoint.remove(); assert.equal(renders, 0);
});

const week = 7 * 24 * 60 * 60_000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const checkpointPath = (jobPath: string, key = 'image', workspace = 'workspace-a') => {
  const scheduledAt = Number(jobPath.slice(jobPath.lastIndexOf('slot_') + 5));
  return `private_autonomy_checkpoints/${String(scheduledAt + week).padStart(16, '0')}/${workspace}/${sha(jobPath)}/image-${sha(key)}.jpg`;
};

test('active checkpoints retain the same paid photo, voice and exact review after more than seven days', async t => {
  const f = await fixture();
  const scheduledAt = Number(f.job.id.slice(5));
  let now = scheduledAt + 1_000;
  t.mock.method(Date, 'now', () => now);
  await f.set({ state: 'retry_generation' });
  let images = 0, voices = 0, reviews = 0;
  const providers = {
    renderImage: (async () => { images++; return f.image; }) as never,
    verifyArtwork: (async () => { reviews++; }) as never,
  };
  const source = { sceneLines: ['Satu', 'Dua', 'Tiga', 'Empat'], model: REELS_VOICE_MODEL };
  const voice = async () => { voices++; return { pcm: Buffer.alloc(48_000), sampleRate: 24000 as const,
    model: REELS_VOICE_MODEL, sceneDurations: [.25, .25, .25, .25] }; };
  const first = f.make(providers);
  const image = await first.renderImage(f.imageParams);
  const audio = await first.voice(source, voice);
  await first.verifyArtwork(image, f.imageParams);
  const originalNames = [...f.files.keys()];
  assert.equal(originalNames.length, 3);
  for (const name of originalNames) {
    assert.ok(name.startsWith(`private_autonomy_checkpoints/${String(scheduledAt + week).padStart(16, '0')}/`));
    assert.deepEqual(f.metadata.get(name)?.metadata, { autonomyJobPath: f.job.path, savedAt: String(now) });
  }
  now += week + 2 * 24 * 60 * 60_000;
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, async path => {
    assert.equal(path, f.job.path); return f.row();
  });
  const resumed = f.make(providers);
  assert.deepEqual(await resumed.renderImage(f.imageParams), image);
  assert.deepEqual(await resumed.voice(source, voice), audio);
  await resumed.verifyArtwork(image, f.imageParams);
  assert.deepEqual({ images, voices, reviews }, { images: 1, voices: 1, reviews: 1 });
  assert.ok(originalNames.every(name => f.files.has(name)));
  assert.equal([...f.files.keys()].filter(name => name.startsWith('private_autonomy_checkpoints/')).length, 3);
});

test('sweeping retains every active or unknown job and removes only terminal or absent jobs after the grace period', async () => {
  const f = await fixture();
  const now = Date.now(), old = now - 3 * week;
  const jobs = new Map<string, Record<string, unknown>>();
  const kept: string[] = [], deleted: string[] = [];
  let index = 0;
  const add = (state: string | undefined, keep: boolean, jobTime = now - 2 * week, savedAt = old) => {
    const jobPath = `auto_content_rules/rule-${index++}/jobs/slot_${old}`;
    const path = checkpointPath(jobPath);
    f.put(path, f.image, { metadata: { autonomyJobPath: jobPath, savedAt: String(savedAt) } }, savedAt);
    if (state !== undefined) jobs.set(jobPath, { state, finishedAt: jobTime, updatedAt: jobTime });
    (keep ? kept : deleted).push(path);
    return jobPath;
  };
  for (const state of ['generating', 'retry_generation', 'prepared', 'queued', 'publishing', 'retry_publication', 'needs_attention', 'unknown_state']) add(state, true);
  for (const state of ['published', 'failed', 'cancelled', 'skipped']) add(state, false);
  add(undefined, false);
  add('failed', true, now - 1_000);
  add('cancelled', true, old, now - 1_000);
  add(undefined, true, old, now - 1_000);
  const noFinish = add('published', true); jobs.set(noFinish, { state: 'published' });
  const updated = add('failed', true); jobs.set(updated, { state: 'failed', finishedAt: old, updatedAt: now - 1_000 });
  const objectUpdated = add('failed', true);
  f.metadata.get(checkpointPath(objectUpdated))!.updated = new Date(now - 1_000).toISOString();
  f.files.set('private_studio_checkpoints/workspace-a/image.jpg', f.image);
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, async path => jobs.get(path));
  assert.ok(kept.every(path => f.files.has(path)));
  assert.ok(deleted.every(path => !f.files.has(path)));
  assert.ok(f.files.has('private_studio_checkpoints/workspace-a/image.jpg'));
});

test('legacy files and mismatched job metadata are retained without reading another server path', async () => {
  const f = await fixture();
  const now = Date.now(), old = now - 3 * week;
  const jobPath = `auto_content_rules/rule-a/jobs/slot_${old}`;
  const paths = ['legacy', 'foreign-scope', 'foreign-digest', 'bad-age', 'bad-prefix'].map(key => checkpointPath(jobPath, key));
  f.put(paths[0], f.image, {}, old);
  f.put(paths[1], f.image, { metadata: { autonomyJobPath: 'workspaces/other/private_meta_connections/account', savedAt: String(old) } }, old);
  f.put(paths[2], f.image, { metadata: { autonomyJobPath: `auto_content_rules/other-rule/jobs/slot_${old}`, savedAt: String(old) } }, old);
  f.put(paths[3], f.image, { metadata: { autonomyJobPath: jobPath, savedAt: 'not-a-timestamp' } }, old);
  const wrongPrefix = paths[4].replace(String(old + week).padStart(16, '0'), String(old + 1).padStart(16, '0'));
  paths[4] = wrongPrefix;
  f.put(wrongPrefix, f.image, { metadata: { autonomyJobPath: jobPath, savedAt: String(old) } }, old);
  let reads = 0;
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, async () => { reads++; return undefined; });
  assert.equal(reads, 0);
  assert.ok(paths.every(path => f.files.has(path)));
});

test('a persisted bounded scan cursor advances past active files to clean later terminal jobs', async () => {
  const f = await fixture();
  const now = Date.now(), old = now - 3 * week;
  const activeJob = `auto_content_rules/active/jobs/slot_${old}`;
  const active: string[] = [];
  for (let index = 0; index < 30; index++) {
    const path = checkpointPath(activeJob, String(index), 'aaa-workspace');
    f.put(path, f.image, { metadata: { autonomyJobPath: activeJob, savedAt: String(old) } }, old);
    active.push(path);
  }
  const terminalJob = `auto_content_rules/terminal/jobs/slot_${old}`;
  const terminal = checkpointPath(terminalJob, 'terminal', 'zzz-workspace');
  f.put(terminal, f.image, { metadata: { autonomyJobPath: terminalJob, savedAt: String(old) } }, old);
  const queries: Parameters<typeof f.bucket.getFiles>[0][] = [];
  const originalList = f.bucket.getFiles;
  f.bucket.getFiles = async options => { queries.push(options); return originalList(options); };
  const readJob = async (path: string) => path === activeJob ? { state: 'retry_generation' }
    : { state: 'failed', finishedAt: old, updatedAt: old };
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, readJob);
  assert.ok(f.files.has(terminal), 'the terminal job lies beyond the first 24 objects');
  const cursorPath = 'private_autonomy_maintenance/checkpoint_cursor.json';
  const cursor = JSON.parse(f.files.get(cursorPath)!.toString());
  assert.equal(typeof cursor.after, 'string');
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, readJob);
  assert.equal(f.files.has(terminal), false);
  assert.ok(active.every(path => f.files.has(path)));
  assert.ok(queries.every(query => query.maxResults === 24 && query.autoPaginate === false));
  assert.equal(queries[1].startOffset, cursor.after);
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, readJob);
  assert.equal(JSON.parse(f.files.get(cursorPath)!.toString()).after, null, 'the scan wraps at the end');
});

test('job read failures and replacement uploads never allow deleting the wrong generation', async () => {
  const f = await fixture();
  const now = Date.now(), old = now - 3 * week;
  const jobPath = `auto_content_rules/replaced/jobs/slot_${old}`;
  const path = checkpointPath(jobPath);
  f.put(path, f.image, { metadata: { autonomyJobPath: jobPath, savedAt: String(old) } }, old);
  const replacement = Buffer.from('new-private-content');
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, async () => {
    f.put(path, replacement, { metadata: { autonomyJobPath: jobPath, savedAt: String(now) } }, now);
    return { state: 'published', finishedAt: old, updatedAt: old };
  });
  assert.deepEqual(f.files.get(path), replacement);
  const failedPath = checkpointPath(`auto_content_rules/read-failed/jobs/slot_${old}`);
  f.put(failedPath, f.image, { metadata: { autonomyJobPath: `auto_content_rules/read-failed/jobs/slot_${old}`, savedAt: String(old) } }, old);
  f.files.delete('private_autonomy_maintenance/checkpoint_cursor.json');
  let failedReads = 0;
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, async () => { failedReads++; throw new Error('Temporary job read failure'); });
  assert.equal(failedReads, 1);
  assert.ok(f.files.has(failedPath));
});

test('sweep work stays within its deadline and does not delete after a slow job read returns', async t => {
  const f = await fixture();
  const now = Date.now(), old = now - 3 * week;
  let wallClock = now;
  t.mock.method(Date, 'now', () => wallClock);
  const jobPath = `auto_content_rules/slow-read/jobs/slot_${old}`;
  const path = checkpointPath(jobPath);
  f.put(path, f.image, { metadata: { autonomyJobPath: jobPath, savedAt: String(old) } }, old);
  await sweepExpiredScheduledCheckpoints(now, () => f.bucket as never, async () => {
    wallClock += 2_001;
    return { state: 'failed', finishedAt: old, updatedAt: old };
  });
  assert.ok(f.files.has(path));
  assert.equal(JSON.parse(f.files.get('private_autonomy_maintenance/checkpoint_cursor.json')!.toString()).after, path);
});
