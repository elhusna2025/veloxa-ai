import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from './youtube-production-test-store';
import { blankBusinessProfile } from '../business-context';
import { runYouTubeProductionStep, youtubeProductionApi } from './youtube-production-jobs';
import type { requireWorkspace } from './auth';
import type { YouTubeProductionSettings, YouTubeScriptBlock } from '../youtube-production';

function fixture() {
  const store = new Store(), workspaceId = 'youtube-production-test';
  const workspaceRef = store.collection('workspaces').doc(workspaceId);
  store.rows.set(workspaceRef.path, { ownerUid: 'owner', snapshotJson: JSON.stringify({ brand: blankBusinessProfile(workspaceId, 'primary', 'Dafini Code') }) });
  const authorize = (async () => ({ user: { uid: 'owner' }, workspace: (await workspaceRef.get()).data(), ref: workspaceRef, workspaceId })) as unknown as typeof requireWorkspace;
  const url = `https://veloxa.example.test/api/veloxa/youtube/productions/?workspaceId=${workspaceId}&businessId=primary`;
  const id = randomUUID();
  const settings = { kind: 'short', minutes: 1, topic: 'Mengenal catatan usaha yang mudah dipahami', voice: 'marin' };
  const deps = { authorize, models: async () => ({}) };
  const request = (body?: object) => new Request(url, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {});
  const create = (patch: object = {}) => youtubeProductionApi(request({ id, settings: { ...settings, ...patch } }), undefined, deps);
  const action = (body: object) => youtubeProductionApi(request(body), id, deps);
  const jobRef = () => {
    const key = [...store.rows.keys()].find(key => /^private_youtube_productions\/[^/]+$/.test(key))!;
    return store.collection('private_youtube_productions').doc(key.split('/')[1]);
  };
  return { store, deps, create, action, jobRef, workspaceRef, id, request };
}
function block(index = 0): YouTubeScriptBlock {
  return { index, chapter: 'Memulai dengan satu catatan', scenes: Array.from({ length: 4 }, () => {
    const narration = 'Mari kita pahami langkah pertama dengan contoh sederhana agar setiap orang mengetahui alasan dan tujuan sebelum mencoba cara yang sama pada kegiatan usaha mereka sendiri hari ini.';
    return { title: 'Mulai dari catatan usaha', supporting: 'Pahami manfaat lewat contoh sederhana.', narration, visual: 'Seorang pengelola memeriksa catatan transaksi di meja usaha.', characterIds: [], lines: [{ speakerId: 'narrator', text: narration }] };
  }) };
}
test('lost create response reuses the production, rejects changed intent and isolates scopes', async () => {
  const f = fixture();
  assert.equal((await f.create()).status, 200);
  const count = f.store.rows.size;
  assert.equal((await f.create()).status, 200); assert.equal(f.store.rows.size, count);
  assert.equal((await f.create({ topic: 'Topik lain yang belum disetujui' })).status, 409);
  const other = new Request(f.request().url.replace('businessId=primary', 'businessId=b_' + randomUUID()));
  assert.equal((await youtubeProductionApi(other, f.id, f.deps)).status, 409);
});
test('script retries preserve the outline and wait for explicit script approval before paid media', async () => {
  const f = fixture(); await f.create();
  const ref = f.jobRef() as unknown as FirebaseFirestore.DocumentReference;
  let calls = 0;
  const deps = { reserve: async () => ({ mode: 'standard' as const, day: '2026-11-22', used: 1, dailyLimit: 3 }),
    plan: async () => { calls++; return { title: 'Catatan Usaha yang Terarah', description: 'Contoh sederhana.', chapters: ['Mulai dari satu catatan'] }; },
    script: async () => { throw new Error('Temporary provider timeout'); } };
  await runYouTubeProductionStep(ref, deps);
  assert.equal((await f.jobRef().get()).data()?.state, 'scripting');
  await runYouTubeProductionStep(ref, deps);
  let saved = (await f.jobRef().get()).data()!;
  assert.equal(saved.state, 'scripting'); assert.equal(saved.scriptIndex, 0); assert.ok(Number(saved.retryAt) > Date.now());
  f.store.rows.set(f.jobRef().path, { ...saved, nextRunAt: 0 });
  await runYouTubeProductionStep(ref, { ...deps, script: async () => block() });
  saved = (await f.jobRef().get()).data()!;
  assert.equal(calls, 1); assert.equal(saved.state, 'script_review'); assert.equal(saved.imageIndex, 0);
  await runYouTubeProductionStep(ref, deps); assert.equal((await f.jobRef().get()).data()?.state, 'script_review');
  const stale = await f.action({ action: 'approve_script', revision: Number(saved.revision) - 1, confirmed: true }); assert.equal(stale.status, 409);
  const accepted = await f.action({ action: 'approve_script', revision: saved.revision, confirmed: true }); assert.equal(accepted.status, 200);
  assert.equal((await f.jobRef().get()).data()?.state, 'producing');
});
test('cast approval is separate and owner changes fence off queued AI work', async () => {
  const f = fixture(); await f.create({ characters: [{ id: 'actor_1', name: 'Rani', appearance: 'Perempuan berambut pendek dan memakai kemeja biru.', voice: 'coral', delivery: 'Tenang' }] });
  const ref = f.jobRef() as unknown as FirebaseFirestore.DocumentReference;
  const saved = (await f.jobRef().get()).data()!;
  f.store.rows.set(f.jobRef().path, { ...saved, state: 'script_review', scriptIndex: 1, outline: { title: 'Judul', description: '', chapters: ['Awal'] } });
  assert.equal((await f.action({ action: 'approve_script', revision: saved.revision, confirmed: true })).status, 200);
  assert.equal((await f.jobRef().get()).data()?.state, 'characters');
  let called = false;
  f.store.rows.set(f.workspaceRef.path, { ...f.store.rows.get(f.workspaceRef.path), ownerUid: 'someone-else' });
  await runYouTubeProductionStep(ref, { plan: async () => { called = true; throw new Error(); } });
  assert.equal(called, false); assert.equal((await f.jobRef().get()).data()?.state, 'attention');
});

test('a rejected cast reference gets a new version without changing speaker IDs or replaying the script', async () => {
  const f = fixture(); await f.create({ characters: [{ id: 'actor_1', name: 'Rani', appearance: 'Perempuan berambut pendek dengan kemeja biru.', voice: 'coral', delivery: 'Hangat' }] });
  const saved = (await f.jobRef().get()).data()!;
  f.store.rows.set(f.jobRef().path, { ...saved, state: 'character_review', scriptIndex: 1, portraitIndex: 1 });
  const response = await f.action({ action: 'revise_character', revision: saved.revision, characterId: 'actor_1', appearance: 'Perempuan berambut panjang dengan kemeja biru.', voice: 'sage', delivery: 'Tenang dan ekspresif', confirmed: true });
  assert.equal(response.status, 200);
  const result = (await f.jobRef().get()).data()!;
  assert.equal(result.state, 'characters'); assert.equal(result.portraitIndex, 0); assert.equal(result.scriptIndex, 1);
  assert.equal((result.characterVersions as Record<string, number>).actor_1, 2);
  const settings = result.settings as YouTubeProductionSettings;
  assert.equal(settings.characters[0].id, 'actor_1'); assert.equal(settings.characters[0].name, 'Rani'); assert.equal(settings.characters[0].voice, 'sage');
});

test('manual recovery requeues the same checkpoints without holding navigation for AI work', async () => {
  const f = fixture(); await f.create();
  const saved = (await f.jobRef().get()).data()!;
  f.store.rows.set(f.jobRef().path, { ...saved, state: 'attention', scriptIndex: 1, imageIndex: 2,
    audioIndex: 0, attempts: 8, nextRunAt: Number.MAX_SAFE_INTEGER,
    outline: { title: 'Judul tersimpan', description: '', chapters: ['Awal'] } });
  const quotaRows = [...f.store.rows.keys()].filter(key => key.includes('quotas/'));
  let response = await f.action({ action: 'resume', revision: saved.revision, confirmed: true });
  assert.equal(response.status, 200);
  let current = (await f.jobRef().get()).data()!;
  assert.equal(current.state, 'producing'); assert.equal(current.imageIndex, 2); assert.equal(current.scriptIndex, 1);
  assert.equal(current.lease, null); assert.equal(current.attempts, 0); assert.ok(Number(current.nextRunAt) <= Date.now());
  f.store.rows.set(f.jobRef().path, { ...current, attempts: 2, retryAt: Date.now() + 60_000, nextRunAt: Date.now() + 60_000 });
  response = await f.action({ action: 'retry_now', revision: current.revision, confirmed: true });
  assert.equal(response.status, 200);
  current = (await f.jobRef().get()).data()!;
  assert.equal(current.imageIndex, 2); assert.equal(current.attempts, 2); assert.equal(current.lease, null);
  assert.deepEqual([...f.store.rows.keys()].filter(key => key.includes('quotas/')), quotaRows);
  assert.equal((await f.action({ action: 'retry_now', revision: saved.revision, confirmed: true })).status, 409);
});
