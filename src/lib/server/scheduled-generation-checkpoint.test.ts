import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { BRAND_PRESETS, generateBrandContentDraft } from '../veloxa-engine';
import type { ContentAgentParams } from './content-agent';
import { ApiError } from './http';
import { scheduledGenerationCheckpoint, sweepExpiredScheduledCheckpoints } from './scheduled-generation-checkpoint';
import { REELS_VOICE_MODEL } from './reels-voice';

async function fixture() {
  let row: Record<string, any> = {}, active = true;
  const files = new Map<string, Buffer>();
  const job = { id: 'slot_1795183200000', path: 'auto_content_rules/rule-a/jobs/slot_1795183200000', get: async () => ({ data: () => structuredClone(row) }) };
  const assertActive = async () => { if (!active) throw new ApiError(409, 'Lease changed'); };
  const update = async (values: Record<string, unknown>) => { await assertActive(); row = { ...row, ...structuredClone(values) }; };
  const bucket = {
    file: (path: string) => ({
      name: path,
      download: async () => { const bytes = files.get(path); if (!bytes) throw Object.assign(new Error('Absent'), { code: 404 }); return [Buffer.from(bytes)]; },
      save: async (bytes: Buffer) => { files.set(path, Buffer.from(bytes)); },
      delete: async () => { files.delete(path); },
    }),
    getFiles: async ({ prefix, endOffset }: { prefix: string; endOffset?: string }) => [[...files.keys()]
      .filter(path => path.startsWith(prefix) && (!endOffset || path < endOffset)).map(path => bucket.file(path))],
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
  return { make, job, files, bucket, params, image, imageParams, row: () => row, set: update, stop: () => { active = false; } };
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

test('expired checkpoints are swept without touching another private storage root', async () => {
  const f = await fixture();
  f.files.set('private_autonomy_checkpoints/0000000000000001/workspace-a/old/image.jpg', f.image);
  f.files.set('private_autonomy_checkpoints/9999999999999999/workspace-a/new/image.jpg', f.image);
  f.files.set('private_studio_checkpoints/workspace-a/image.jpg', f.image);
  await sweepExpiredScheduledCheckpoints(Date.now(), () => f.bucket as never);
  assert.equal(f.files.size, 2);
  assert.ok([...f.files.keys()].some(path => path.startsWith('private_studio_checkpoints/')));
});
