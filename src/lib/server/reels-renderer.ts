import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobe from 'ffprobe-static';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ApiError } from './http';
import { REELS_SPEC } from '../reels-spec';

const execFileAsync = promisify(execFile);
const ffmpegBinary = ffmpegInstaller.path;
const ffprobeBinary = ffprobe.path;
const WIDTH = 720;
const HEIGHT = 1280;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const SAFE_RENDER_ERROR = new ApiError(503, 'Video Reels belum dapat dirender. Silakan coba lagi.', 'reels_render_unavailable');
const INVALID_RENDER_INPUT = new ApiError(400, 'Gambar, audio, atau durasi Reels tidak valid.', 'invalid_reels_render_input');

export interface ReelsRenderParams {
  images: Buffer[];
  pcm: Buffer;
  sampleRate: 24000;
  sceneWeights?: number[];
}

export interface ReelsRenderResult {
  mp4: Buffer;
  poster: Buffer;
  width: 720;
  height: 1280;
  durationSeconds: number;
  mimeType: 'video/mp4';
}

function validateParams(params: ReelsRenderParams): number {
  if (!params || !Array.isArray(params.images) || params.images.length !== REELS_SPEC.sceneCount ||
      params.images.some((image) => !Buffer.isBuffer(image) || image.length === 0 || image.length > MAX_IMAGE_BYTES) ||
      !Buffer.isBuffer(params.pcm) || params.pcm.length === 0 || params.pcm.length % 2 !== 0 ||
      params.sampleRate !== 24000) throw INVALID_RENDER_INPUT;
  const sourceDuration = params.pcm.length / (params.sampleRate * 2);
  if (!Number.isFinite(sourceDuration) || sourceDuration < 10 || sourceDuration > REELS_SPEC.maxSourceAudioSeconds) throw SAFE_RENDER_ERROR;
  if (params.sceneWeights !== undefined && (params.sceneWeights.length !== REELS_SPEC.sceneCount ||
      params.sceneWeights.some((weight) => !Number.isFinite(weight) || weight <= 0))) throw INVALID_RENDER_INPUT;
  return sourceDuration;
}

async function runBinary(binary: string, args: string[], timeout: number) {
  return execFileAsync(binary, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
}

export async function renderReelsVideo(params: ReelsRenderParams): Promise<ReelsRenderResult> {
  const sourceDuration = validateParams(params);
  // Reserve AAC/container padding while retaining every spoken word up to the 60s output limit.
  const targetDuration = Math.min(REELS_SPEC.maxDurationSeconds - REELS_SPEC.encodingHeadroomSeconds, Math.max(REELS_SPEC.minDurationSeconds, sourceDuration));
  const weights = params.sceneWeights || Array(REELS_SPEC.sceneCount).fill(1);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(weightTotal) || weightTotal <= 0) throw INVALID_RENDER_INPUT;
  if (!ffmpegBinary || !ffprobeBinary) throw SAFE_RENDER_ERROR;

  let workDir: string | undefined;
  let phase: 'normalize' | 'encode' | 'probe' | 'verify' = 'normalize';
  const startedAt = Date.now();
  let outputDurationSeconds: number | undefined;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), 'veloxa-reels-'));
    const normalizedImages: Buffer[] = [];
    for (let index = 0; index < params.images.length; index += 1) {
      const normalized = await sharp(params.images[index], { limitInputPixels: 60_000_000 })
        .rotate()
        .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
        .jpeg({ quality: 88 })
        .toBuffer();
      normalizedImages.push(normalized);
      await writeFile(path.join(workDir, `scene${index}.jpg`), normalized);
    }
    const poster = normalizedImages[0];
    await writeFile(path.join(workDir, 'voice.pcm'), params.pcm);
    const concatLines = params.images.map((_, index) => {
      const duration = targetDuration * weights[index] / weightTotal;
      return `file 'scene${index}.jpg'\nduration ${duration.toFixed(6)}`;
    });
    concatLines.push(`file 'scene${REELS_SPEC.sceneCount - 1}.jpg'`);
    await writeFile(path.join(workDir, 'scenes.txt'), `${concatLines.join('\n')}\n`, 'utf8');

    const audioFilters = [`aresample=48000${sourceDuration > targetDuration ? `,atempo=${(sourceDuration / targetDuration).toFixed(6)}` : ''}`, 'apad'];
    const outputPath = path.join(workDir, 'render.mp4');
    phase = 'encode';
    await runBinary(ffmpegBinary, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'concat', '-safe', '0', '-i', path.join(workDir, 'scenes.txt'),
      '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', path.join(workDir, 'voice.pcm'),
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,fps=25,format=yuv420p',
      '-af', audioFilters.join(','), '-t', targetDuration.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-threads', '2', '-pix_fmt', 'yuv420p', '-r', '25',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart',
      outputPath,
    ], 90_000);

    phase = 'verify';
    const outputStat = await stat(outputPath);
    if (!outputStat.isFile() || outputStat.size === 0 || outputStat.size > MAX_VIDEO_BYTES) throw SAFE_RENDER_ERROR;
    phase = 'probe';
    const probeResult = await runBinary(ffprobeBinary, [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json', outputPath,
    ], 8_000);
    const probe = JSON.parse(probeResult.stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
    };
    phase = 'verify';
    const duration = Number(probe.format?.duration);
    if (Number.isFinite(duration)) outputDurationSeconds = duration;
    const video = probe.streams?.find((stream) => stream.codec_type === 'video');
    const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
    if (!Number.isFinite(duration) || duration < REELS_SPEC.minDurationSeconds || duration > REELS_SPEC.maxDurationSeconds || Math.abs(duration - targetDuration) > 0.15 ||
        video?.codec_name !== 'h264' || video.width !== WIDTH || video.height !== HEIGHT || video.r_frame_rate !== '25/1' ||
        audio?.codec_name !== 'aac') throw SAFE_RENDER_ERROR;

    return {
      mp4: await readFile(outputPath),
      poster,
      width: 720,
      height: 1280,
      durationSeconds: duration,
      mimeType: 'video/mp4',
    };
  } catch (error) {
    // Only enum diagnostics and numeric timing; never log media, stderr or file paths.
    const details = error && typeof error === 'object' ? error as { code?: unknown; signal?: unknown; killed?: unknown } : {};
    const processCode = ['ENOENT', 'EACCES', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(String(details.code)) ? String(details.code) : typeof details.code === 'number' ? 'EXIT_NONZERO' : undefined;
    const signal = ['SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV'].includes(String(details.signal)) ? String(details.signal) : undefined;
    const reason = error === SAFE_RENDER_ERROR ? 'output_validation' : processCode === 'ENOENT' ? 'binary_missing' : details.killed === true ? 'deadline_or_signal' : 'operation_failed';
    console.warn(JSON.stringify({ event: 'reels_render_failed', phase, reason, sourceDurationSeconds: sourceDuration, targetDurationSeconds: targetDuration, elapsedMs: Date.now() - startedAt, outputDurationSeconds, processCode, signal }));
    if (error instanceof ApiError && error.code === 'invalid_reels_render_input') throw error;
    throw SAFE_RENDER_ERROR;
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
