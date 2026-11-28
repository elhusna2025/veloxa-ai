import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAND_PRESETS } from '../veloxa-engine';
import { youtubeProductionSettings } from '../youtube-production';
import { writeYouTubeBlock } from './youtube-production-agent';

test('the storyboard illustrates the finished spoken script without rewriting or reordering it', async t => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  const settings = youtubeProductionSettings.parse({ kind: 'short', minutes: 1, topic: 'Kenapa wajah tampak gelap di depan jendela?', direction: 'Jendela hijau dan kursi kuning.', voice: 'achird' });
  const outline = { title: 'Mengatur cahaya', description: 'Wajah dapat terlihat gelap ketika latar sangat terang.', chapters: ['Cara mendapatkan cahaya wajah yang cukup.'] };
  const spoken = Array.from({ length: 7 }, (_, i) => ({
    speakerId: 'narrator', text: 'Langkah ' + (i + 1) + ' membantu kita memahami bagaimana menentukan cahaya pada wajah ketika mengambil foto di dekat jendela.',
  }));
  const kinds: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const req = JSON.parse(String(init.body));
    const kind = req.text.format.name;
    kinds.push(kind);
    let output;
    if (kind === 'youtube_spoken_script') {
      assert.ok(!req.input.includes(settings.direction));
      output = { lines: spoken };
    } else {
      assert.equal(kind, 'youtube_storyboard');
      const brief = JSON.parse(req.input);
      assert.equal(brief.direction, settings.direction);
      assert.deepEqual(brief.passages.map((p: { narration: string }) => p.narration), spoken.map(l => l.text));
      output = { shots: spoken.map((_, index) => ({ index, title: 'Gambar ' + index, supporting: 'Keterangan gambar', characterIds: [], visual: 'Ilustrasi untuk mendukung gagasan narator.' })).reverse() };
    }
    return Response.json({ object: 'response', status: 'completed', output_text: JSON.stringify(output), output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
  });
  const brand = { ...BRAND_PRESETS.cafe_fnb, businessName: 'Studio', businessDescription: '', city: '', offerings: [] };
  const result = await writeYouTubeBlock(settings, brand, outline, 0, null);
  assert.deepEqual(kinds, ['youtube_spoken_script', 'youtube_storyboard']);
  assert.deepEqual(result.scenes.map(s => s.narration), spoken.map(l => l.text));
  assert.deepEqual(result.scenes.map(s => s.title), spoken.map((_, i) => 'Gambar ' + i));
});
