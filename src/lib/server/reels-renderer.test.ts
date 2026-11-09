import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import sharp from 'sharp';
import { renderReelsVideo } from './reels-renderer';

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
  const pcm = Buffer.alloc(24_000 * 2 * 20);
  for (let index = 0; index < pcm.length / 2; index += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * index / 24_000) * 6000);
    pcm.writeInt16LE(sample, index * 2);
  }

  const result = await renderReelsVideo({ images, pcm, sampleRate: 24000 });
  assert.ok(result.mp4.length > 0);
  assert.equal(result.mp4.subarray(4, 8).toString(), 'ftyp');
  assert.equal(result.width, 720);
  assert.equal(result.height, 1280);
  assert.ok(result.durationSeconds >= 20 && result.durationSeconds <= 30);
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
