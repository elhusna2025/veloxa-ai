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
import { composeYouTubeFrame, remuxYouTubeVideo, renderYouTubeScene, sceneFrameCounts } from './youtube-production-renderer';
import { blankBusinessProfile } from '../business-context';
import { youtubeProductionSettings, type YouTubeScene } from '../youtube-production';
import { productionRange } from './youtube-production-preview';

test('timing follows actual dialogue weights and sums to target frames', () => {
  assert.deepEqual(sceneFrameCounts([10, 20, 15, 15], 60), [250, 500, 375, 375]);
  assert.equal(sceneFrameCounts([11.1, 15.4, 18.2, 12.3], 59.8).reduce((sum, frames) => sum + frames, 0), 1495);
  assert.throws(() => sceneFrameCounts([0, 1, 2, 3], 60));
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
    const first = await renderYouTubeScene({ photo: photos[0], overlay, pcm: Buffer.alloc(48000 * 2), frames: 50, startFrame: 0, index: 0, kind: 'video' });
    const second = await renderYouTubeScene({ photo: photos[1], overlay, pcm: Buffer.alloc(48000 * 2), frames: 50, startFrame: 50, index: 1, kind: 'video', previousFrame: first.last });
    const filename = path.join(directory, 'result.mp4');
    await remuxYouTubeVideo(Readable.from([first.ts, second.ts]), createWriteStream(filename));
    assert.ok((await readFile(filename)).length > 1000);
    const result = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename], { encoding: 'utf8' }));
    assert.equal(result.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video').codec_name, 'h264');
    assert.equal(result.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio').codec_name, 'aac');
    assert.ok(Math.abs(Number(result.format.duration) - 4) < .2, `Duration ${result.format.duration}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
