import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobe from 'ffprobe-static';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ApiError } from './http';
import { REELS_PHOTO_MOTIONS, REELS_PHOTO_VERTICAL_ANCHOR, REELS_SPEC } from '../reels-spec';

const execFileAsync = promisify(execFile);
const ffmpegBinary = ffmpegInstaller.path;
const ffprobeBinary = ffprobe.path;
const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 25;
const HALF_TRANSITION_FRAMES = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const SAFE_RENDER_ERROR = new ApiError(503, 'Video Reels belum dapat dirender. Silakan coba lagi.', 'reels_render_unavailable');
const INVALID_RENDER_INPUT = new ApiError(400, 'Gambar, audio, atau durasi Reels tidak valid.', 'invalid_reels_render_input');

export interface ReelsRenderParams {
  images: Buffer[];
  pcm: Buffer;
  sampleRate: 24000;
  sceneWeights?: number[];
  useReviewedFrames?: boolean;
  motionLayers?: { photo: Buffer; overlay: Buffer }[];
  fixedOverlay?: Buffer;
}

export interface ReelsRenderResult {
  mp4: Buffer;
  poster: Buffer;
  width: 720;
  height: 1280;
  durationSeconds: number;
  mimeType: 'video/mp4';
}

function validImageBytes(image: Buffer): boolean {
  return Buffer.isBuffer(image) && image.length > 0 && image.length <= MAX_IMAGE_BYTES;
}

function validateParams(params: ReelsRenderParams): number {
  if (!params || !Array.isArray(params.images) || params.images.length !== REELS_SPEC.sceneCount ||
      !params.images.every(validImageBytes) ||
      !Buffer.isBuffer(params.pcm) || params.pcm.length === 0 || params.pcm.length % 2 !== 0 ||
      params.sampleRate !== 24000) throw INVALID_RENDER_INPUT;
  const sourceDuration = params.pcm.length / (params.sampleRate * 2);
  if (!Number.isFinite(sourceDuration) || sourceDuration < 10 || sourceDuration > REELS_SPEC.maxSourceAudioSeconds) throw SAFE_RENDER_ERROR;
  if (params.sceneWeights !== undefined && (params.sceneWeights.length !== REELS_SPEC.sceneCount ||
      params.sceneWeights.some((weight) => !Number.isFinite(weight) || weight <= 0))) throw INVALID_RENDER_INPUT;
  if (params.motionLayers !== undefined && (!Array.isArray(params.motionLayers) ||
      params.motionLayers.length !== REELS_SPEC.sceneCount ||
      params.motionLayers.some(layer => !layer || !validImageBytes(layer.photo) || !validImageBytes(layer.overlay)))) throw INVALID_RENDER_INPUT;
  if (params.fixedOverlay !== undefined && (!params.motionLayers || !validImageBytes(params.fixedOverlay))) throw INVALID_RENDER_INPUT;
  return sourceDuration;
}

async function writeOverlay(directory: string, name: string, bytes: Buffer) {
  const info = await sharp(bytes, { limitInputPixels: WIDTH * HEIGHT }).metadata();
  if (info.format !== 'png' || !info.hasAlpha || info.width !== WIDTH || info.height !== HEIGHT ||
      (info.orientation && info.orientation !== 1) || (info.pages && info.pages !== 1)) throw INVALID_RENDER_INPUT;
  const file = path.join(directory, name);
  await writeFile(file, bytes);
  return file;
}

function framesPerScene(weights: number[], totalFrames: number, weightTotal: number): number[] {
  let weight = 0;
  let start = 0;
  return weights.map((sceneWeight, index) => {
    weight += sceneWeight;
    const remaining = weights.length - index - 1;
    const end = remaining ? Math.min(totalFrames - remaining, Math.max(start + 1, Math.round(totalFrames * (weight / weightTotal)))) : totalFrames;
    const frames = end - start;
    start = end;
    return frames;
  });
}

function photoMotion(index: number, input: number, start: number, frames: number, duration: number, output: string): string {
  const ease = `(0.5-0.5*cos(PI*(on+${start})/${Math.max(1, duration - 1)}))`;
  const motion = REELS_PHOTO_MOTIONS[index];
  const interpolate = ([from, to]: readonly [number, number]) =>
    from === to ? String(from) : `${from}+(${to}-${from})*${ease}`;
  return `[${input}:v]scale=iw:ih:in_range=pc:out_range=tv,format=yuv420p,zoompan=z='${interpolate(motion.zoom)}':x='(iw-iw/zoom)*(${interpolate(motion.horizontal)})':y='(ih-ih/zoom)*${REELS_PHOTO_VERTICAL_ANCHOR}':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1[${output}]`;
}

async function renderMotionClips(
  directory: string,
  images: { photo: string; overlay: string }[],
  frameCounts: number[],
  deadline: number,
  fixedOverlay?: string,
): Promise<string> {
  // Clip bodies and short transition overlaps are encoded separately. A single
  // FFmpeg concat filter would queue full-resolution frames from later scenes.
  const overlaps = frameCounts.slice(1).map((next, index) =>
    2 * Math.min(HALF_TRANSITION_FRAMES, Math.floor((frameCounts[index] - 1) / 2), Math.floor((next - 1) / 2)));
  const durations = frameCounts.map((nominal, index) =>
    nominal + ((overlaps[index - 1] ?? 0) + (overlaps[index] ?? 0)) / 2);
  const files: string[] = [];
  const clipOutput = fixedOverlay ? 'withTitleOrBlend' : 'visual';

  const encode = async (inputs: string[], filters: string[], frames: number) => {
    const name = `segment${files.length}.mp4`;
    if (fixedOverlay) filters.push(`[${clipOutput}][${inputs.length}:v]overlay=format=yuv420[visual]`);
    const args = [...inputs, ...(fixedOverlay ? [fixedOverlay] : [])].flatMap(input => ['-threads', '1', '-i', input]);
    const deadlineRemaining = deadline - Date.now();
    if (deadlineRemaining < 1) throw SAFE_RENDER_ERROR;
    await runBinary(ffmpegBinary, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_complex_threads', '1', ...args,
      '-filter_complex', filters.join(';'), '-map', '[visual]', '-frames:v', String(frames),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-threads', '2', '-bf', '0',
      '-pix_fmt', 'yuv420p', '-r', String(FPS), path.join(directory, name),
    ], deadlineRemaining);
    files.push(`file '${name}'`);
  };

  for (const [index, image] of images.entries()) {
    const before = overlaps[index - 1] ?? 0;
    const after = overlaps[index] ?? 0;
    const body = durations[index] - before - after;
    const ramp = Math.min(HALF_TRANSITION_FRAMES, Math.floor((body - 1) / 2));
    const fadeIn = before && ramp ? `,fade=t=in:s=0:n=${ramp}:alpha=1` : '';
    const fadeOut = after && ramp ? `,fade=t=out:s=${body - ramp}:n=${ramp}:alpha=1` : '';
    await encode([image.photo, image.overlay], [
      photoMotion(index, 0, before, body, durations[index], 'photo'),
      `[1:v]format=yuva420p,loop=loop=${body - 1}:size=1:start=0,settb=1/${FPS},setpts=N${fadeIn}${fadeOut}[title]`,
      `[photo][title]overlay=format=yuv420[${clipOutput}]`,
    ], body);
    if (after) {
      // App Hosting's bundled FFmpeg predates xfade. Animate the incoming
      // opacity over the outgoing photo, then composite fixed brand assets.
      await encode([image.photo, images[index + 1].photo], [
        photoMotion(index, 0, before + body, after, durations[index], 'outgoing'),
        photoMotion(index + 1, 1, 0, after, durations[index + 1], 'next'),
        `[next]format=yuva420p,fade=t=in:s=0:n=${after - 1}:alpha=1[incoming]`,
        `[outgoing][incoming]overlay=format=yuv420:shortest=1[${clipOutput}]`,
      ], after);
    }
  }
  const listPath = path.join(directory, 'motion-clips.txt');
  await writeFile(listPath, `${files.join('\n')}\n`, 'utf8');
  return listPath;
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
  const deadline = startedAt + 90_000;
  let outputDurationSeconds: number | undefined;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), 'veloxa-reels-'));
    const normalizedImages: Buffer[] = [];
    for (let index = 0; index < params.images.length; index += 1) {
      const frame = params.images[index];
      const image = sharp(frame, { limitInputPixels: 60_000_000 });
      let normalized = frame;
      if (params.useReviewedFrames) {
        const { format, width, height, orientation } = await image.metadata();
        if (format !== 'jpeg' || width !== WIDTH || height !== HEIGHT || (orientation && orientation !== 1)) throw INVALID_RENDER_INPUT;
      } else {
        normalized = await image.rotate().resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 88 }).toBuffer();
      }
      normalizedImages.push(normalized);
      if (!params.motionLayers) await writeFile(path.join(workDir, `scene${index}.jpg`), normalized);
    }
    const poster = normalizedImages[0];
    const voicePath = path.join(workDir, 'voice.pcm');
    await writeFile(voicePath, params.pcm);

    let scenesPath: string;
    let videoCodec: string[];
    if (params.motionLayers) {
      const layers: { photo: string; overlay: string }[] = [];
      for (const [index, layer] of params.motionLayers.entries()) {
        const photo = path.join(workDir, `photo${index}.jpg`);
        // Upscale once to reduce subpixel stepping in zoompan.
        await sharp(layer.photo, { limitInputPixels: 60_000_000 }).rotate()
          .resize(WIDTH * 2, HEIGHT * 2, { fit: 'cover', position: 'centre' })
          .jpeg({ quality: 95 }).toFile(photo);
        layers.push({ photo, overlay: await writeOverlay(workDir, `title${index}.png`, layer.overlay) });
      }
      const fixed = params.fixedOverlay ? await writeOverlay(workDir, 'fixed.png', params.fixedOverlay) : undefined;
      phase = 'encode';
      const frames = framesPerScene(weights, Math.ceil(targetDuration * FPS), weightTotal);
      scenesPath = await renderMotionClips(workDir, layers, frames, deadline, fixed);
      videoCodec = ['-c:v', 'copy'];
    } else {
      const concatLines = weights.map((weight, index) =>
        `file 'scene${index}.jpg'\nduration ${(targetDuration * (weight / weightTotal)).toFixed(6)}`);
      concatLines.push(`file 'scene${REELS_SPEC.sceneCount - 1}.jpg'`);
      scenesPath = path.join(workDir, 'scenes.txt');
      await writeFile(scenesPath, `${concatLines.join('\n')}\n`, 'utf8');
      videoCodec = [
        '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-threads', '2', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      ];
    }

    const audioFilters = [`aresample=48000${sourceDuration > targetDuration ? `,atempo=${(sourceDuration / targetDuration).toFixed(6)}` : ''}`, 'apad'];
    const outputPath = path.join(workDir, 'render.mp4');
    phase = 'encode';
    const deadlineRemaining = deadline - Date.now();
    if (deadlineRemaining < 1) throw SAFE_RENDER_ERROR;
    await runBinary(ffmpegBinary, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'concat', '-safe', '0', '-i', scenesPath,
      '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', voicePath,
      '-map', '0:v:0', '-map', '1:a:0', ...videoCodec,
      '-af', audioFilters.join(','), '-t', targetDuration.toFixed(3),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart',
      outputPath,
    ], deadlineRemaining);

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
