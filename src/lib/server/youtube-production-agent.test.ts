import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAND_PRESETS } from '../veloxa-engine';
import { youtubeProductionSettings } from '../youtube-production';
import sharp from 'sharp';
import { parseYouTubeScript } from '../youtube-script-import';
import { createYouTubePhoto, youtubeShotContext, writeYouTubeBlock } from './youtube-production-agent';

test('the storyboard illustrates the finished spoken script without rewriting or reordering it', async t => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  const settings = youtubeProductionSettings.parse({ kind: 'short', minutes: 1, genre: 'tutorial', topic: 'Kenapa wajah tampak gelap di depan jendela?', direction: 'Jendela hijau dan kursi kuning.', voice: 'achird' });
  const outline = { title: 'Mengatur cahaya', description: 'Wajah dapat terlihat gelap ketika latar sangat terang.', chapters: ['Cara mendapatkan cahaya wajah yang cukup.'] };
  const spoken = Array.from({ length: 7 }, (_, i) => ({
    speakerId: 'narrator', text: 'Langkah ' + (i + 1) + ' membantu kita memahami bagaimana menentukan cahaya pada wajah ketika mengambil foto di dekat jendela.',
  }));
  const kinds: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const req = JSON.parse(String(init.body));
    const kind = req.text.format.name;
    kinds.push(kind);
    assert.ok(!req.input.includes('Unrelated publisher product'));
    let output;
    if (kind === 'youtube_spoken_script') {
      assert.ok(!req.input.includes(settings.direction));
      assert.match(JSON.parse(req.input).storyDirection, /hasil praktis/);
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
  const brand = { ...BRAND_PRESETS.cafe_fnb, businessName: 'Studio', businessDescription: 'Unrelated publisher product', city: '', offerings: [] };
  const result = await writeYouTubeBlock(settings, brand, outline, 0, null);
  assert.deepEqual(kinds, ['youtube_spoken_script', 'youtube_storyboard']);
  assert.deepEqual(result.scenes.map(s => s.narration), spoken.map(l => l.text));
  assert.deepEqual(result.scenes.map(s => s.title), spoken.map((_, i) => 'Gambar ' + i));
});

test('a short chapter can be repaired between its opening hook and closing sentence', async t => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  const words = (token: string, count: number) => Array(count).fill(token).join(' ') + '.';
  const line = (text: string) => ({ speakerId: 'narrator', text });
  const opening = words('pembukaan', 30), ending = words('penutup', 30);
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const req = JSON.parse(String(init.body)), brief = JSON.parse(req.input);
    let result;
    if (req.text.format.name === 'youtube_storyboard') {
      result = { shots: brief.passages.map(({ index }: { index: number }) => ({ index, title: 'Adegan', supporting: 'Teks pendukung', visual: 'Ilustrasi yang mendukung narasi.', characterIds: [] })) };
    } else if (req.text.format.name === 'youtube_script_bridge') {
      assert.equal(brief.before[0].text, opening);
      assert.equal(brief.after[0].text, ending);
      result = { lines: [line(words('cerita', 55))] };
    } else {
      result = { lines: [line(opening), line(ending)] };
    }
    return Response.json({ object: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  });
  const settings = youtubeProductionSettings.parse({ kind: 'short', minutes: 1, genre: 'horror', topic: 'Kamar yang hanya muncul di malam hari', voice: 'achird' });
  const block = await writeYouTubeBlock(settings, BRAND_PRESETS.cafe_fnb as Parameters<typeof writeYouTubeBlock>[1], { title: 'Kamar', description: '', chapters: ['Kunci di dinding'] }, 0, null);
  assert.equal(block.scenes[0].narration, opening);
  assert.equal(block.scenes.at(-1)?.narration, ending);
});

test('visual requests ground a short hook in the story and exclude publisher identity across formats', async t => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const prompts: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    prompts.push(JSON.parse(String(init.body)).prompt);
    return Response.json({ data: [{ b64_json: jpeg.toString('base64') }] });
  });
  for (const kind of ['short', 'video'] as const) {
    const settings = youtubeProductionSettings.parse({ kind, minutes: 1, topic: 'Kisah seorang pianis di Vienna', voice: 'achird' });
    const block = parseYouTubeScript('Menit 1 — Audisi\nBayangkan...\n\nMalam itu ia memainkan konser pertamanya.')[0];
    const outline = { title: settings.topic, description: '', chapters: [block.chapter] };
    const brand = { ...BRAND_PRESETS.cafe_fnb, businessName: 'Unrelated publisher', websiteUrl: 'https://unrelated.test', businessDescription: 'Inventory software', primaryColorHex: '#123456', accentColorHex: 'Publisher injected as a color' } as Parameters<typeof createYouTubePhoto>[2];
    await createYouTubePhoto(block.scenes[0], settings, brand, undefined, [], undefined, false, true, 0, youtubeShotContext(outline, block, 0));
    const prompt = prompts.at(-1)!;
    assert.match(prompt, /pianis di Vienna/);
    assert.match(prompt, /konser pertamanya/);
    assert.match(prompt, /Bayangkan/);
    assert.match(prompt, /#123456/);
    assert.doesNotMatch(prompt, /Unrelated publisher|unrelated.test|Inventory software|Publisher injected/i);
  }
});

test('imported short sentences share an illustration while narration and explicit visual breaks survive', () => {
  const speech = 'Bayangkan... Usia Anda baru 22 tahun. Anda belum menyelesaikan kuliah.';
  const [block] = parseYouTubeScript(speech + '\nVisual: Mahasiswa di kamar asrama.\n\nKemudian ada tawaran.');
  assert.equal(block.scenes.length, 2);
  assert.equal(block.scenes[0].narration, speech);
  assert.match(block.scenes[0].visual, /kamar asrama/);
  assert.equal(block.scenes[1].narration, 'Kemudian ada tawaran.');
});

test('landscape import holds short narrator fragments together and respects a directed shot', () => {
  const phrases = Array.from({ length: 14 }, (_, i) => `Pada hari ke-${i + 1} dia menerima sebuah surat baru.`);
  const input = phrases.join('\n\n') + '\n\nIa akhirnya berangkat.\nVisual: Sebuah kereta meninggalkan stasiun.';
  const [landscape] = parseYouTubeScript(input, [], 'video');
  assert.ok(landscape.scenes.length >= 3 && landscape.scenes.length <= 5);
  assert.equal(landscape.scenes.map(scene => scene.narration).join(' '), phrases.join(' ') + ' Ia akhirnya berangkat.');
  assert.match(landscape.scenes.at(-1)!.visual, /kereta meninggalkan stasiun/);
  assert.equal(parseYouTubeScript(input, [], 'short')[0].scenes.length, 15);
});
