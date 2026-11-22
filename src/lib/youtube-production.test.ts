import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionProgress, productionResources, validateCast, validateScriptBlock, youtubeProductionSettings, type YouTubeProduction } from './youtube-production';

const settings = youtubeProductionSettings.parse({ kind: 'video', minutes: 60, topic: 'Cara mengelola bisnis kecil dengan catatan yang terarah', voice: 'marin' });
test('duration drives independent script and scene budgets, including long form', () => {
  for (const minutes of [1, 15, 30, 60, 120]) {
    const result = productionResources({ ...settings, minutes });
    assert.equal(result.scenes, 4 * minutes);
    assert.equal(result.minWords, minutes * 105);
    assert.equal(result.maxWords, minutes * 125);
    assert.equal(result.width, 1280);
  }
  assert.equal(youtubeProductionSettings.safeParse({ ...settings, kind: 'short' }).success, false);
  assert.equal(youtubeProductionSettings.safeParse({ ...settings, minutes: 121 }).success, false);
});
function block() {
  return { scenes: Array.from({ length: 4 }, () => {
    const narration = 'Mari kita pahami langkah pertama dengan contoh sederhana agar setiap orang mengetahui alasan dan tujuan sebelum mencoba cara yang sama pada kegiatan usaha mereka sendiri hari ini.';
    return { title: 'Mulai dari catatan usaha', supporting: 'Pahami langkah dan tujuan lewat contoh sederhana.', narration,
      visual: 'Seorang pengelola usaha memeriksa catatan transaksi di meja kasir.', characterIds: [], lines: [{ speakerId: 'narrator', text: narration }] };
  }) };
}
test('dialogue must match the reviewed narration, with bounded natural word counts', () => {
  assert.equal(validateScriptBlock(block()).scenes.length, 4);
  const mismatch = block(); mismatch.scenes[0].lines[0].text = 'Kata lain yang tidak ditinjau.';
  assert.throws(() => validateScriptBlock(mismatch), /harus sama/);
  const long = block(); long.scenes[0].narration += ' tambahan'.repeat(100);
  assert.throws(() => validateScriptBlock(long));
});
test('only the saved cast may speak or appear; narrator stays separate', () => {
  const value = { ...block(), index: 0, chapter: 'Pembukaan' };
  assert.doesNotThrow(() => validateCast(value, settings));
  value.scenes[0].lines[0].speakerId = 'actor_5';
  assert.throws(() => validateCast(value, settings), /di luar/);
  const cast = { ...settings, characters: [{ id: 'actor_5', name: 'Rani', appearance: 'Perempuan berambut pendek dengan kemeja biru.', voice: 'coral' as const, delivery: 'Tenang dan ramah.' }] };
  assert.doesNotThrow(() => validateCast(value, cast));
  value.scenes[0].characterIds = ['actor_1'] as never[];
  assert.throws(() => validateCast(value, cast), /di luar/);
});

test('production progress distinguishes images, speech, encoding and final merge using actual counters', () => {
  const item: YouTubeProduction = { id: 'test', revision: 1, settings: { ...settings, minutes: 1, kind: 'short' }, state: 'producing',
    blocks: [{ ...block(), index: 0, chapter: 'Awal' }], outline: { title: 'Judul', description: '', chapters: ['Awal'] }, completedScenes: 0, createdAt: 1, updatedAt: 2,
    progress: { images: 0, audio: 0, rendered: 0, characters: 0, attempts: 0, working: true, checkedAt: 3 } };
  let model = productionProgress(item);
  assert.equal(model.phase, 'images'); assert.equal(model.detail, 'Membuat gambar adegan 1 dari 4');
  assert.equal(model.done, 2); assert.equal(model.total, 12);
  item.progress!.images = 4; model = productionProgress(item); assert.equal(model.phase, 'audio');
  item.progress!.audio = 1; item.progress!.rendered = 4; model = productionProgress(item);
  assert.equal(model.phase, 'render'); assert.equal(model.detail, 'Menggabungkan adegan menjadi video akhir'); assert.equal(model.done, 11);
  item.state = 'ready'; model = productionProgress(item); assert.equal(model.done, model.total);
});

test('legacy status never fabricates completed media or completion before approval', () => {
  const item: YouTubeProduction = { id: 'test', revision: 1, settings: { ...settings, minutes: 1 }, state: 'script_review', blocks: [{ ...block(), index: 0, chapter: 'Awal' }], outline: { title: 'Judul', description: '', chapters: ['Awal'] }, completedScenes: 0, createdAt: 1, updatedAt: 2 };
  assert.match(productionProgress(item).detail, /Menunggu tinjauan/);
  assert.equal(productionProgress(item).steps.find(row => row.id === 'images')!.done, 0);
  item.state = 'producing'; assert.equal(productionProgress(item).detail, 'Menyiapkan gambar dan suara');
});
