import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionResources, validateCast, validateScriptBlock, youtubeProductionSettings } from './youtube-production';

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
