import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import sharp from 'sharp';
import { renderReelsVideo } from './reels-renderer';
import { REELS_SPEC } from '../reels-spec';

const require = createRequire(import.meta.url);
const ffmpegBinary = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;

test('menolak jumlah gambar, audio, sampel, dan bobot adegan yang tidak valid', async () => {
  const pcm = Buffer.alloc(24000 * 2 * 20);
  const images = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c'), Buffer.from('d')];
  await assert.rejects(renderReelsVideo({ images: images.slice(0, 3), pcm, sampleRate: 24000 }), { code: 'invalid_reels_render_input' });
  await assert.rejects(renderReelsVideo({ images, pcm: Buffer.alloc(0), sampleRate: 24000 }), { code: 'invalid_reels_render_input' });
  await assert.rejects(renderReelsVideo({ images, pcm, sampleRate: 48000 as 24000 }), { code: 'invalid_reels_render_input' });
  await assert.rejects(renderReelsVideo({ images, pcm, sampleRate: 24000, sceneWeights: [1, 0, 1, 1] }), { code: 'invalid_reels_render_input' });
  await assert.rejects(renderReelsVideo({ images, pcm: Buffer.alloc(24000 * 2 * 9), sampleRate: 24000 }), { code: 'reels_render_unavailable' });
  await assert.rejects(renderReelsVideo({ images, pcm: Buffer.alloc(REELS_SPEC.maxSourceAudioSeconds * 48_000 + 2), sampleRate: 24000 }), { code: 'reels_render_unavailable' });
});

test('render diagnostics contain only safe phase/timing fields, never image bytes or raw errors', async () => {
  const messages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (value: unknown) => { messages.push(String(value)); };
  try {
    await assert.rejects(renderReelsVideo({ images: Array.from({ length: 4 }, () => Buffer.from('PRIVATE_MEDIA_SENTINEL')), pcm: Buffer.alloc(24000 * 2 * 20), sampleRate: 24000 }), { code: 'reels_render_unavailable' });
  } finally { console.warn = originalWarn; }
  assert.equal(messages.length, 1);
  assert.equal(messages[0].includes('PRIVATE_MEDIA_SENTINEL'), false);
  const event = JSON.parse(messages[0]);
  assert.equal(event.event, 'reels_render_failed');
  assert.equal(event.phase, 'normalize');
  assert.equal(event.reason, 'operation_failed');
  assert.equal(typeof event.elapsedMs, 'number');
  assert.deepEqual(Object.keys(event).sort(), ['elapsedMs', 'event', 'phase', 'reason', 'sourceDurationSeconds', 'targetDurationSeconds']);
});

test('merender MP4 H.264/AAC potret dari empat gambar dan audio PCM nyata secara offline', { timeout: 120_000 }, async () => {
  const colors = [
    { r: 230, g: 35, b: 35 },
    { r: 35, g: 190, b: 55 },
    { r: 35, g: 70, b: 225 },
    { r: 235, g: 205, b: 35 },
  ];
  const images = await Promise.all(colors.map((background) => sharp({
    create: { width: 720, height: 1280, channels: 3, background },
  }).jpeg().toBuffer()));
  const pcm = Buffer.alloc(24_000 * 2 * 25);
  for (let index = 0; index < pcm.length / 2; index += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * index / 24_000) * 6000);
    pcm.writeInt16LE(sample, index * 2);
  }

  const result = await renderReelsVideo({ images, pcm, sampleRate: 24000 });
  assert.ok(result.mp4.length > 0);
  assert.equal(result.mp4.subarray(4, 8).toString(), 'ftyp');
  assert.equal(result.width, 720);
  assert.equal(result.height, 1280);
  assert.ok(result.durationSeconds >= REELS_SPEC.minDurationSeconds && result.durationSeconds <= REELS_SPEC.maxDurationSeconds);
  assert.ok(Math.abs(result.durationSeconds - 25) < 0.15, 'normal 25s narration keeps its original timing');
  assert.equal(result.mimeType, 'video/mp4');
  const poster = await sharp(result.poster).metadata();
  assert.equal(poster.format, 'jpeg');
  assert.equal(poster.width, 720);
  assert.equal(poster.height, 1280);

  const sampleDir = await mkdtemp(path.join(tmpdir(), 'veloxa-reels-test-'));
  try {
    const videoPath = path.join(sampleDir, 'render.mp4');
    await writeFile(videoPath, result.mp4);
    const sampleFrame = (seconds: number) => execFileSync(ffmpegBinary, [
      '-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', videoPath,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { maxBuffer: 4 * 1024 * 1024 });
    const first = sampleFrame(0.1);
    const last = sampleFrame(Math.max(0.1, result.durationSeconds - 0.2));
    const centerOffset = (640 * 720 + 360) * 3;
    const firstPixel = [...first.subarray(centerOffset, centerOffset + 3)];
    const lastPixel = [...last.subarray(centerOffset, centerOffset + 3)];
    assert.ok(firstPixel[0] > firstPixel[1] * 2 && firstPixel[0] > firstPixel[2] * 2, `Warna frame pertama tidak sesuai: ${firstPixel}`);
    assert.ok(lastPixel[0] > lastPixel[2] * 2 && lastPixel[1] > lastPixel[2] * 2, `Warna frame terakhir tidak sesuai: ${lastPixel}`);
  } finally {
    await rm(sampleDir, { recursive: true, force: true });
  }
});


test('30/31s timing is preserved and 60/61s narration reserves AAC padding without cutting the ending', { timeout: 300_000 }, async () => {
  const images = await Promise.all(['#e63232', '#32c832', '#3232dc', '#dcca32'].map(background => sharp({ create: { width: 720, height: 1280, channels: 3, background } }).jpeg().toBuffer()));
  const sampleDir = await mkdtemp(path.join(tmpdir(), 'veloxa-reels-padding-test-'));
  try {
    for (const seconds of [30, 31, 60, 61]) {
      const pcm = Buffer.alloc(24_000 * 2 * seconds);
      // An audible marker only in the final 80ms detects trimming instead of time compression.
      for (let sample = 24_000 * seconds - 1920; sample < pcm.length / 2; sample += 1) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * sample / 24_000) * 6000), sample * 2);
      const result = await renderReelsVideo({ images, pcm, sampleRate: 24000, sceneWeights: [10, 12, 15, 13], useReviewedFrames: true });
      assert.deepEqual(result.poster, images[0]);
      const target = Math.min(seconds, REELS_SPEC.maxDurationSeconds - REELS_SPEC.encodingHeadroomSeconds);
      assert.ok(result.durationSeconds >= REELS_SPEC.minDurationSeconds && result.durationSeconds <= REELS_SPEC.maxDurationSeconds, `actual duration ${result.durationSeconds} must stay within the publication bounds`);
      assert.ok(Math.abs(result.durationSeconds - target) < 0.15, `source ${seconds}s should render near ${target}s`);
      assert.equal(result.mp4.subarray(4, 8).toString(), 'ftyp');
      const videoPath = path.join(sampleDir, `source-${seconds}.mp4`);
      await writeFile(videoPath, result.mp4);
      const ending = execFileSync(ffmpegBinary, ['-hide_banner', '-loglevel', 'error', '-ss', String(result.durationSeconds - 0.2), '-i', videoPath, '-vn', '-ac', '1', '-ar', '24000', '-f', 's16le', 'pipe:1'], { maxBuffer: 128 * 1024 });
      let energy = 0;
      for (let sample = 0; sample < ending.length / 2; sample += 1) energy += ending.readInt16LE(sample * 2) ** 2;
      assert.ok(Math.sqrt(energy / (ending.length / 2)) > 200, `source ${seconds}s must retain its final audio marker`);
    }
  } finally { await rm(sampleDir, { recursive: true, force: true }); }
});
