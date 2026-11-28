import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffprobe from 'ffprobe-static';
import { composeYouTubeFrame, normalizeYouTubeSceneAudio, remuxYouTubeVideo, renderYouTubeScene, sceneFrameCounts } from './youtube-production-renderer';
import { blankBusinessProfile } from '../business-context';
import { youtubeProductionSettings, type YouTubeScene } from '../youtube-production';
import { productionRange } from './youtube-production-preview';

test('timing follows actual dialogue weights and sums to target frames', () => {
  assert.deepEqual(sceneFrameCounts([10, 20, 15, 15], 60), [250, 500, 375, 375]);
  assert.equal(sceneFrameCounts([11.1, 15.4, 18.2, 12.3], 59.8).reduce((sum, frames) => sum + frames, 0), 1495);
  assert.throws(() => sceneFrameCounts([0, 1, 2, 3], 60));
  const seven = sceneFrameCounts([4, 6, 7, 8, 9, 10, 12], 59.8);
  assert.equal(seven.length, 7); assert.equal(seven.reduce((a, b) => a + b, 0), 1495);
  assert.ok(seven[0] < seven[6]);
});
test('private preview ranges handle seek, suffix, malformed and out of bounds requests', () => {
  assert.deepEqual(productionRange('bytes=5-9', 20), { start: 5, end: 9, partial: true });
  assert.deepEqual(productionRange('bytes=-5', 20), { start: 15, end: 19, partial: true });
  assert.deepEqual(productionRange('bytes=5-', 20), { start: 5, end: 19, partial: true });
  for (const range of ['bytes=20-', 'bytes=5-4', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=-']) assert.equal(productionRange(range, 20), null);
});
const scene: YouTubeScene = { title: 'Mulai dari catatan usaha', supporting: 'Pahami manfaatnya melalui satu contoh sederhana.', narration: 'Kalimat contoh narasi untuk pengujian media.', lines: [{ speakerId: 'narrator', text: 'Kalimat contoh narasi untuk pengujian media.' }], characterIds: [], visual: 'Foto ruang usaha yang terang.' };
test('both video canvases keep measured text on natural photo space and reject unreadable regions', async () => {
  const brand = blankBusinessProfile('ws', 'primary', 'Dafini Code');
  for (const kind of ['short', 'video'] as const) {
    const settings = youtubeProductionSettings.parse({ kind, minutes: 1, topic: 'Pahami manfaat catatan usaha', voice: 'marin' });
    const width = kind === 'short' ? 720 : 1280, height = kind === 'short' ? 1280 : 720;
    const photo = await sharp({ create: { width, height, channels: 3, background: '#efefed' } }).jpeg().toBuffer();
    const frame = await composeYouTubeFrame(photo, scene, settings, brand);
    const metadata = await sharp(frame.overlay).metadata(); assert.equal(metadata.width, width); assert.equal(metadata.height, height); assert.equal(metadata.hasAlpha, true);
    const strip = Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><rect width="${width / 3}" height="100%" fill="white"/></svg>`);
    await assert.rejects(composeYouTubeFrame(strip, scene, settings, brand), /ruang teks/);
  }
});

test('a landscape horizon can separate the title and supporting copy during a pan', async () => {
  const settings = youtubeProductionSettings.parse({ kind: 'video', minutes: 5, topic: 'Sejarah Kota Bandar Lampung', voice: 'marin' });
  const photo = Buffer.from('<svg width="1280" height="720"><rect width="1280" height="720" fill="#aac9ed"/><rect y="240" width="1280" height="120" fill="#172137"/></svg>');
  const frame = await composeYouTubeFrame(photo, { ...scene, title: 'Dua Kota Berbeda', supporting: 'Namun nama itu menyimpan kisah dua kota yang pernah berdiri terpisah.' }, settings, blankBusinessProfile('ws', 'primary', 'Cendekia AI'), 1);
  assert.equal((await sharp(frame.image).metadata()).width, 1280);
});

test('a dark object outside the actual moving lettering no longer rejects a readable photograph', async () => {
  const settings = youtubeProductionSettings.parse({ kind: 'short', minutes: 1, topic: 'Pahami manfaat catatan usaha', voice: 'marin' });
  const photo = await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#efefed' } })
    .composite([{ input: Buffer.from('<svg width="720" height="90"><rect width="720" height="90" fill="black"/></svg>'), left: 0, top: 680 }]).jpeg().toBuffer();
  const frame = await composeYouTubeFrame(photo, scene, settings, blankBusinessProfile('ws', 'primary', 'Dafini Code'));
  assert.ok(frame.image.length > 1000);
});
test('real segmented rendering produces a continuous H264/AAC MP4 with both scenes', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'youtube-production-test-'));
  try {
    const overlay = await sharp({ create: { width: 1280, height: 720, channels: 4, background: '#00000000' } }).png().toBuffer();
    const photos = await Promise.all(['#ff3333', '#3333ff'].map(background => sharp({ create: { width: 1280, height: 720, channels: 3, background } }).jpeg().toBuffer()));
    const pcm = Buffer.alloc(48000 * 2);
    for (let sample = 0; sample < pcm.length / 2; sample++) pcm.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * 330 * sample / 24000)), sample * 2);
    const first = await renderYouTubeScene({ photo: photos[0], overlay, pcm, frames: 50, startFrame: 0, index: 0, kind: 'video' });
    const second = await renderYouTubeScene({ photo: photos[1], overlay, pcm, frames: 50, startFrame: 50, index: 1, kind: 'video', previousFrame: first.last });
    const filename = path.join(directory, 'result.mp4');
    await remuxYouTubeVideo(Readable.from([first.ts, second.ts]), Readable.from([first.audio, second.audio]), createWriteStream(filename), 100);
    assert.ok((await readFile(filename)).length > 1000);
    const result = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', filename], { encoding: 'utf8' }));
    assert.equal(result.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video').codec_name, 'h264');
    assert.equal(result.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio').codec_name, 'aac');
    assert.ok(Math.abs(Number(result.format.duration) - 4) < .2, `Duration ${result.format.duration}`);
    assert.equal(Number(result.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video').nb_read_frames), 100);
    const binary = (await import('@ffmpeg-installer/ffmpeg')).default.path;
    const decoded = execFileSync(binary, ['-v', 'error', '-i', filename, '-map', '0:a:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { maxBuffer: 1024 * 1024 });
    // The former all-silence fixture missed ~700ms of chopped speech at EVERY join.
    // A continuous voiced signal must survive both the boundary and the final word.
    for (let offset = 2400; offset < 24000 * 3.9; offset += 240) {
      let energy = 0;
      for (let sample = offset; sample < offset + 240; sample++) energy += decoded.readInt16LE(sample * 2) ** 2;
      assert.ok(Math.sqrt(energy / 240) > 1500, `Audio gap at ${offset / 24000}s`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('lossless scene audio has exactly the samples used by the picture timeline', async () => {
  const pcm = Buffer.alloc(48000 * 3);
  pcm.writeInt16LE(12000, pcm.length - 4);
  const audio = await normalizeYouTubeSceneAudio(pcm, 75);
  assert.equal(audio.length, 75 * 960 * 2);
  assert.deepEqual(audio, pcm);
});
