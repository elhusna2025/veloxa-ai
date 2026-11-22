import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { YOUTUBE_MAX_BYTES } from '../youtube-upload-types';
import { ApiError } from './http';
import { resolveYouTubeProbe, youtubeProbeSupported } from './youtube-ffprobe';
import { measureYouTubeProbe, probeUploadFile } from './youtube-upload-media';

const videoStream = { codec_type: 'video', width: 16, height: 16 };
const available = { skip: !youtubeProbeSupported() };

test('probe accepts stream duration when container duration is missing or unusable', () => {
  const streams = [{ ...videoStream, duration: '179' }, { codec_type: 'audio', duration: '180' }];
  for (const format of [{}, { duration: 'N/A' }, { duration: '0' }]) {
    assert.deepEqual(measureYouTubeProbe({ format, streams }), {
      width: 16, height: 16, durationSeconds: 180, shortsEligible: true,
    });
  }
  assert.deepEqual(measureYouTubeProbe({ streams: [{ ...videoStream, duration: '180.001' }] }), {
    width: 16, height: 16, durationSeconds: 180.001, shortsEligible: false,
  });
  assert.throws(() => measureYouTubeProbe({ format: {}, streams: [{ ...videoStream, duration: true }] }), {
    code: 'youtube_invalid_video',
  });
});

function pipedWebm(seconds: number, audio = false, timestampMode = 'disabled') {
  // The bundled encoder handles only this trusted synthetic test source.
  return execFileSync(ffmpeg.path, [
    '-v', 'error', '-filter_threads', '1', '-f', 'lavfi', '-i', `color=c=black:s=16x16:r=1:d=${seconds}`,
    ...(audio ? [
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(seconds),
      '-c:a', 'libopus', '-b:a', '16k', '-compression_level', '0', '-frame_duration', '60',
      '-avoid_negative_ts', timestampMode, '-live', '1',
    ] : []),
    '-c:v', 'libvpx', '-threads:v', '1', '-f', 'webm', 'pipe:1',
  ], { timeout: 20_000, maxBuffer: 512 * 1024 });
}

async function probeMetadata(path: string) {
  const binary = await resolveYouTubeProbe();
  return JSON.parse(execFileSync(binary, [
    '-v', 'error', '-protocol_whitelist', 'file', '-f', 'matroska',
    '-of', 'json', '-show_entries', 'format=duration:stream=duration', '-i', path,
  ], { encoding: 'utf8', timeout: 8_000, maxBuffer: 16 * 1024 })) as {
    format: { duration?: string };
    streams: Array<{ duration?: string }>;
  };
}

test('packet timing trims Opus padding from real WebM at the Shorts limit', available, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veloxa-webm-test-'));
  try {
    for (const seconds of [179, 180, 181]) {
      const path = join(directory, `${seconds}.webm`);
      await writeFile(path, pipedWebm(seconds, true));
      const metadata = await probeMetadata(path);
      assert.equal(metadata.format.duration, undefined);
      assert.ok(metadata.streams.length > 0);
      assert.ok(metadata.streams.every(stream => stream.duration === undefined));
      assert.deepEqual(await probeUploadFile(path, 'video/webm', AbortSignal.timeout(8_000)), {
        width: 16, height: 16, durationSeconds: seconds, shortsEligible: seconds <= 180,
      });
    }

    // The muxer's automatic shift starts VP8 7ms after audio. Preserve that offset.
    const delayedVideo = join(directory, 'delayed-video.webm');
    await writeFile(delayedVideo, pipedWebm(180, true, 'auto'));
    const shifted = await probeUploadFile(delayedVideo, 'video/webm', AbortSignal.timeout(8_000));
    assert.equal(shifted.durationSeconds, 180.007);
    assert.equal(shifted.shortsEligible, false);

    const justOver = join(directory, 'one-millisecond-over.webm');
    const video = pipedWebm(180);
    // A 1,001ms default frame duration extends the final frame to exactly 180.001 seconds.
    const originalDuration = Buffer.from('23e383843b9aca00', 'hex');
    const durationOffset = video.indexOf(originalDuration);
    assert.ok(durationOffset >= 0);
    assert.equal(video.lastIndexOf(originalDuration), durationOffset);
    video.writeUInt32BE(1_001_000_000, durationOffset + 4);
    await writeFile(justOver, video);
    const over = await probeUploadFile(justOver, 'video/webm', AbortSignal.timeout(8_000));
    assert.equal(over.durationSeconds, 180.001);
    assert.equal(over.shortsEligible, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('WebM with unknown last packet duration reports a lower bound and stays ineligible for Shorts', available, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veloxa-webm-test-'));
  try {
    const path = join(directory, 'unknown-tail.webm');
    const video = pipedWebm(181);
    // Replace the 1s track DefaultDuration element with an equal-sized EBML Void.
    const oneSecondDefaultDuration = Buffer.from('23e383843b9aca00', 'hex');
    const offset = video.indexOf(oneSecondDefaultDuration);
    assert.ok(offset >= 0);
    assert.equal(video.lastIndexOf(oneSecondDefaultDuration), offset);
    Buffer.from('ec86000000000000', 'hex').copy(video, offset);
    await writeFile(path, video);
    const metadata = await probeMetadata(path);
    assert.equal(metadata.format.duration, undefined);
    assert.equal(metadata.streams[0].duration, undefined);
    assert.deepEqual(await probeUploadFile(path, 'video/webm', AbortSignal.timeout(8_000)), {
      width: 16, height: 16, durationSeconds: 180, durationIsLowerBound: true, shortsEligible: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('packet reader handles real Opus padding and rejects oversized or cancelled inputs', available, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'veloxa-webm-test-'));
  try {
    const path = join(directory, 'audio-video.webm');
    await writeFile(path, pipedWebm(4, true));
    const result = await probeUploadFile(path, 'video/webm', AbortSignal.timeout(8_000));
    assert.equal(result.shortsEligible, true);
    assert.equal(result.durationIsLowerBound, undefined);
    assert.equal(result.durationSeconds, 4);
    const cancelled = new Error('test cancelled');
    await assert.rejects(probeUploadFile(path, 'video/webm', AbortSignal.abort(cancelled)), error => error === cancelled);
    await truncate(path, YOUTUBE_MAX_BYTES + 1);
    await assert.rejects(probeUploadFile(path, 'video/webm', AbortSignal.timeout(8_000)),
      error => error instanceof ApiError && error.code === 'youtube_invalid_video');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
