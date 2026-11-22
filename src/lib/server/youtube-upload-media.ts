import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import { YOUTUBE_CHUNK_BYTES, YOUTUBE_MAX_BYTES, type YouTubeUploadOperation } from '../youtube-upload-types';
import { adminBucket } from './firebase';
import { ApiError } from './http';
import { resolveYouTubeProbe } from './youtube-ffprobe';
import { assertWorkActive, type UploadWorkSignal } from './youtube-upload-deadline';

const execute = promisify(execFile);
const storageAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] });
const metadata = z.object({ generation: z.string().regex(/^[1-9]\d{0,19}$/), size: z.string().regex(/^\d{1,12}$/) });

export function uploadChunkSize(total: number, index: number) {
  return Math.min(YOUTUBE_CHUNK_BYTES, total - index * YOUTUBE_CHUNK_BYTES);
}

export async function readUploadChunk(request: Request, expected: number, hash: string) {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/octet-stream') {
    throw new ApiError(415, 'Gunakan format data biner untuk mengirim bagian video.');
  }
  if (Number(request.headers.get('content-length') ?? 0) > expected) throw new ApiError(413, 'Bagian video melebihi batas.');
  const reader = request.body?.getReader();
  if (!reader || expected <= 0 || expected > YOUTUBE_CHUNK_BYTES) throw new ApiError(400, 'Bagian video tidak valid.');
  const bytes = Buffer.allocUnsafe(expected);
  let size = 0;
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  deadline.addEventListener('abort', cancel, { once: true });
  try {
    deadline.throwIfAborted();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.byteLength > expected) {
        void reader.cancel().catch(() => {});
        throw new ApiError(413, 'Bagian video melebihi batas.');
      }
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    deadline.throwIfAborted();
  } finally {
    deadline.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  if (size !== expected || createHash('sha256').update(bytes).digest('hex') !== hash) {
    throw new ApiError(409, 'Bagian video berbeda dari file yang ditinjau. Pilih kembali file yang sama.', 'youtube_chunk_mismatch');
  }
  return bytes;
}

class StorageFailure extends Error {
  constructor(readonly status: number) { super('Penyimpanan video belum merespons.'); }
}

export async function withinUploadDeadline<T>(run: () => Promise<T>, signal: UploadWorkSignal): Promise<T> {
  assertWorkActive(signal);
  let interrupt = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    interrupt = () => reject(signal.reason);
    signal.addEventListener('abort', interrupt, { once: true });
  });
  try { return await Promise.race([run(), cancelled]); }
  finally { signal.removeEventListener('abort', interrupt); }
}

async function storageRequest(url: URL, init: RequestInit = {}, signal?: UploadWorkSignal) {
  assertWorkActive(signal);
  const deadline = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
  const accessToken = await withinUploadDeadline(() => storageAuth.getAccessToken(), deadline);
  if (!accessToken) throw new StorageFailure(503);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  // Credential acquisition can outlast the source or worker deadline.
  assertWorkActive(signal);
  deadline.throwIfAborted();
  return fetch(url, {
    ...init, headers, redirect: 'error', cache: 'no-store', signal: deadline,
  });
}

function objectsUrl(upload = false) {
  return new URL(`https://storage.googleapis.com/${upload ? 'upload/' : ''}storage/v1/b/${encodeURIComponent(adminBucket().name)}/o`);
}

function objectUrl(path: string, generation?: string) {
  const url = objectsUrl();
  url.pathname += `/${encodeURIComponent(path)}`;
  if (generation) url.searchParams.set('generation', generation);
  return url;
}

function objectPath(jobKey: string, index?: number, hash?: string) {
  if (!/^[0-9a-f]{64}_[0-9a-f-]{36}$/.test(jobKey)) throw new StorageFailure(400);
  if (index === undefined) return `private-youtube-uploads/${jobKey}/source`;
  if (!Number.isInteger(index) || index < 0 || index >= 32 || !hash || !/^[0-9a-f]{64}$/.test(hash)) throw new StorageFailure(400);
  return `private-youtube-uploads/${jobKey}/chunk-${index}-${hash}`;
}

async function readMetadata(response: Response, expected: number) {
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new StorageFailure(response.status);
  }
  const reader = response.body.getReader();
  const result: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > 16 * 1024) {
        void reader.cancel().catch(() => {});
        throw new StorageFailure(502);
      }
      result.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const parsed = metadata.safeParse(JSON.parse(Buffer.concat(result).toString('utf8')));
  if (!parsed.success || Number(parsed.data.size) !== expected) throw new StorageFailure(502);
  return parsed.data.generation;
}

type FileManifest = YouTubeUploadOperation['file'];
export type UploadMedia = {
  stage(jobKey: string, index: number, hash: string, bytes: Buffer, signal?: UploadWorkSignal): Promise<string>;
  compose(jobKey: string, file: FileManifest, chunks: string[], signal: UploadWorkSignal): Promise<string>;
  measure(jobKey: string, file: FileManifest, generation: string, signal: UploadWorkSignal): Promise<NonNullable<YouTubeUploadOperation['measured']>>;
  read(jobKey: string, generation: string, start: number, end: number, total: number, signal: UploadWorkSignal): Promise<Buffer>;
  cleanup(jobKey: string, file: FileManifest, chunks: Record<string, string>, sourceGeneration: string | null, signal: AbortSignal): Promise<void>;
};

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => {});
}

async function stage(jobKey: string, index: number, hash: string, bytes: Buffer, signal?: UploadWorkSignal) {
  const path = objectPath(jobKey, index, hash);
  const url = objectsUrl(true);
  url.search = new URLSearchParams({ uploadType: 'media', ifGenerationMatch: '0', name: path, fields: 'generation,size' }).toString();
  const result = await storageRequest(url, {
    method: 'POST', body: bytes as unknown as BodyInit, headers: { 'Content-Type': 'application/octet-stream' },
  }, signal);
  if (result.status !== 412) return readMetadata(result, bytes.byteLength);
  await cancelBody(result);
  // Chunk paths are private, create-only and include the reviewed hash.
  const current = objectUrl(path);
  current.searchParams.set('fields', 'generation,size');
  return readMetadata(await storageRequest(current, {}, signal), bytes.byteLength);
}

async function compose(jobKey: string, file: FileManifest, chunks: string[], signal: UploadWorkSignal) {
  if (!chunks.length || chunks.length !== file.chunkHashes.length || chunks.some(value => !metadata.shape.generation.safeParse(value).success)) {
    throw new StorageFailure(400);
  }
  const destination = objectPath(jobKey);
  const url = objectUrl(destination);
  url.pathname += '/compose';
  url.search = new URLSearchParams({ ifGenerationMatch: '0', fields: 'generation,size' }).toString();
  // The SDK converts object generations to numbers. Preserve the provider's full decimal value.
  const result = await storageRequest(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      destination: { contentType: file.mimeType },
      sourceObjects: chunks.map((generation, index) => ({
        name: objectPath(jobKey, index, file.chunkHashes[index]),
        generation,
        objectPreconditions: { ifGenerationMatch: generation },
      })),
    }),
  }, signal);
  if (result.status !== 412) return readMetadata(result, file.size);
  await cancelBody(result);
  const current = objectUrl(destination);
  current.searchParams.set('fields', 'generation,size');
  return readMetadata(await storageRequest(current, {}, signal), file.size);
}

const probeOutput = z.object({
  format: z.object({ duration: z.unknown().optional() }).optional(),
  streams: z.array(z.object({
    codec_type: z.string(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
    index: z.number().int().nonnegative().optional(), time_base: z.string().optional(), sample_rate: z.string().optional(),
    duration: z.unknown().optional(), sample_aspect_ratio: z.string().optional(),
    disposition: z.object({ attached_pic: z.number().optional() }).optional(),
    tags: z.object({ rotate: z.string().optional() }).optional(),
    side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
  })),
});

const invalidVideo = () => new ApiError(422, 'File video tidak dapat divalidasi. Gunakan video MP4, MOV, atau WebM yang dapat diputar.', 'youtube_invalid_video');
const probeEnvironment = { LC_ALL: 'C', NODE_ENV: 'production' } as const;
const maximumPacketLines = 500_000;
const maximumPacketOutputBytes = 32 * 1024 * 1024;
const maximumPacketLineBytes = 64;

function positiveDuration(value: unknown) {
  const duration = typeof value === 'string' && /^\d{1,16}(?:\.\d{1,6})?$/.test(value) ? Number(value) : value;
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function readYouTubeProbe(output: unknown) {
  const parsed = probeOutput.safeParse(output);
  if (!parsed.success) throw invalidVideo();
  const { streams, format } = parsed.data;
  const videos = streams.filter(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const video = videos[0];
  if (videos.length !== 1 || !video?.width || !video.height || video.width > 16_384 || video.height > 16_384) throw invalidVideo();
  const rotation = video.side_data_list?.find(side => side.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0);
  const rightAngle = Math.round(rotation / 90);
  if (!Number.isFinite(rotation) || Math.abs(rotation - rightAngle * 90) > 0.01) throw invalidVideo();
  const sampleAspect = video.sample_aspect_ratio;
  const parts = sampleAspect && /^(\d{1,6}):(\d{1,6})$/.exec(sampleAspect);
  if (sampleAspect && sampleAspect !== 'N/A' && !parts) throw invalidVideo();
  const [numerator, denominator] = parts && Number(parts[1]) && Number(parts[2])
    ? [Number(parts[1]), Number(parts[2])] : [1, 1];
  const swapped = Math.abs(rightAngle % 2) === 1;
  const width = swapped ? video.height : video.width;
  const height = swapped ? video.width : video.height;
  const displayWidth = swapped ? video.height * denominator : video.width * numerator;
  const displayHeight = swapped ? video.width * numerator : video.height * denominator;
  const mediaStreams = [video, ...streams.filter(stream => stream.codec_type === 'audio')];
  const formatDuration = positiveDuration(format?.duration);
  const streamDurations = mediaStreams.map(stream => positiveDuration(stream.duration));
  return {
    width, height, upright: displayWidth <= displayHeight, mediaStreams,
    durationSeconds: Math.max(formatDuration ?? 0, ...streamDurations.map(duration => duration ?? 0)),
    hasCompleteDuration: formatDuration !== undefined || streamDurations.every(duration => duration !== undefined),
  };
}

type YouTubeProbe = ReturnType<typeof readYouTubeProbe>;

function measuredVideo(probe: YouTubeProbe, durationSeconds: number, hasCompleteDuration: boolean, packetsWithinLimit = true): NonNullable<YouTubeUploadOperation['measured']> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw invalidVideo();
  return {
    durationSeconds, width: probe.width, height: probe.height,
    shortsEligible: hasCompleteDuration && packetsWithinLimit && durationSeconds <= 180 && probe.upright,
    ...(!hasCompleteDuration && { durationIsLowerBound: true }),
  };
}

export function measureYouTubeProbe(output: unknown): NonNullable<YouTubeUploadOperation['measured']> {
  const probe = readYouTubeProbe(output);
  return measuredVideo(probe, probe.durationSeconds, probe.hasCompleteDuration);
}

type PacketTrack = {
  tickScale: bigint;
  sampleScale: bigint | undefined;
  denominator: bigint;
  firstStart?: bigint;
  lastEnd?: bigint;
  lastPts: number;
  lastUnknownDurationPts: number;
};

function packetTracks(probe: YouTubeProbe) {
  const tracks = new Map<number, PacketTrack>();
  for (const stream of probe.mediaStreams) {
    const timeBase = /^([1-9]\d{0,9})\/([1-9]\d{0,9})$/.exec(stream.time_base ?? '');
    if (stream.index === undefined || tracks.has(stream.index) || !timeBase) throw invalidVideo();
    const sampleRateText = stream.codec_type === 'audio' ? stream.sample_rate : undefined;
    const sampleRate = sampleRateText && /^[1-9]\d{0,8}$/.test(sampleRateText) ? BigInt(sampleRateText) : undefined;
    const timeBaseDenominator = BigInt(timeBase[2]);
    tracks.set(stream.index, {
      tickScale: BigInt(timeBase[1]) * (sampleRate ?? 1n),
      sampleScale: sampleRate === undefined ? undefined : timeBaseDenominator,
      denominator: timeBaseDenominator * (sampleRate ?? 1n),
      lastPts: -Infinity, lastUnknownDurationPts: -Infinity,
    });
  }
  return tracks;
}

function recordPacket(line: string, tracks: Map<number, PacketTrack>) {
  // FFprobe writes the two optional padding counts together for Skip Samples side data.
  const fields = /^(\d{1,5}),(-?\d{1,16}|N\/A),(\d{1,16}|N\/A)(?:,(\d{1,10}),(\d{1,10}))?$/.exec(line);
  if (!fields) throw invalidVideo();
  const track = tracks.get(Number(fields[1]));
  if (!track) return;
  const pts = Number(fields[2]);
  const duration = fields[3] === 'N/A' ? 0 : Number(fields[3]);
  if (!Number.isSafeInteger(pts) || !Number.isSafeInteger(duration)) throw invalidVideo();
  const skip = Number(fields[4] ?? 0);
  const discard = Number(fields[5] ?? 0);
  if (skip > 0xffffffff || discard > 0xffffffff || ((skip || discard) && track.sampleScale === undefined)) throw invalidVideo();
  const rawStart = BigInt(pts) * track.tickScale;
  const offset = track.sampleScale ?? 0n;
  const untrimmedEnd = rawStart + BigInt(duration) * track.tickScale;
  const trimmedStart = rawStart + BigInt(skip) * offset;
  const trimmedEnd = untrimmedEnd - BigInt(discard) * offset;
  // Matroska decodes negative timestamps for preroll without presenting them.
  const start = trimmedStart < 0n ? 0n : trimmedStart;
  if (duration > 0 && trimmedEnd < trimmedStart) throw invalidVideo();
  if (duration > 0 && trimmedEnd <= start) return;
  const end = duration > 0 ? trimmedEnd : start;
  if (track.firstStart === undefined || start < track.firstStart) track.firstStart = start;
  if (track.lastEnd === undefined || end > track.lastEnd) track.lastEnd = end;
  track.lastPts = Math.max(track.lastPts, pts);
  if (duration === 0) track.lastUnknownDurationPts = Math.max(track.lastUnknownDurationPts, pts);
}

async function readPacketLines(stdout: Readable, tracks: Map<number, PacketTrack>, signal: AbortSignal) {
  let bytes = 0;
  let lines = 0;
  let pending = '';
  for await (const chunk of stdout as AsyncIterable<Buffer>) {
    signal.throwIfAborted();
    bytes += chunk.length;
    if (bytes > maximumPacketOutputBytes) throw invalidVideo();
    const text = pending + chunk.toString('latin1');
    let offset = 0;
    for (let newline = text.indexOf('\n'); newline !== -1; newline = text.indexOf('\n', offset)) {
      lines += 1;
      if (lines > maximumPacketLines || newline - offset > maximumPacketLineBytes) throw invalidVideo();
      recordPacket(text.slice(offset, newline), tracks);
      offset = newline + 1;
    }
    pending = text.slice(offset);
    if (pending.length > maximumPacketLineBytes) throw invalidVideo();
  }
  if (pending) throw invalidVideo();
}

type PacketTime = { numerator: bigint; denominator: bigint };

function comparePacketTime(left: PacketTime, right: PacketTime) {
  return left.numerator * right.denominator - right.numerator * left.denominator;
}

function measurePacketTiming(tracks: Map<number, PacketTrack>) {
  // Tracks are ordered with the single video stream first. An empty audio track has no timeline.
  if (tracks.values().next().value?.firstStart === undefined) throw invalidVideo();
  let first: PacketTime | undefined;
  let last: PacketTime | undefined;
  let completeDuration = true;
  for (const track of tracks.values()) {
    if (track.firstStart === undefined || track.lastEnd === undefined) continue;
    const start = { numerator: track.firstStart, denominator: track.denominator };
    const end = { numerator: track.lastEnd, denominator: track.denominator };
    if (!first || comparePacketTime(start, first) < 0n) first = start;
    if (!last || comparePacketTime(end, last) > 0n) last = end;
    if (track.lastUnknownDurationPts >= track.lastPts) completeDuration = false;
  }
  if (!first || !last) throw invalidVideo();
  const numerator = comparePacketTime(last, first);
  const denominator = last.denominator * first.denominator;
  return {
    durationSeconds: Number(numerator / denominator) + Number(numerator % denominator) / Number(denominator),
    // Avoid rounding a fractional tick down onto the Shorts limit.
    completeDuration, withinShortsLimit: numerator <= 180n * denominator,
  };
}

async function probeWebmPackets(binary: string, input: string[], localPath: string, probe: YouTubeProbe, signal: AbortSignal) {
  const tracks = packetTracks(probe);
  assertWorkActive(signal);
  // Use demuxed packet durations without inferring a frame rate from earlier frames.
  const child = spawn(binary, [
    ...input, '-nofind_stream_info', '-of', 'csv=p=0', '-show_packets',
    '-show_entries', 'packet=stream_index,pts,duration:packet_side_data=skip_samples,discard_padding', '-i', localPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'], signal, killSignal: 'SIGKILL', windowsHide: true, env: probeEnvironment });
  let processError: Error | undefined;
  child.once('error', error => { processError = error; });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  let probeFailed = false;
  child.stderr.on('data', () => {
    probeFailed = true;
    child.kill('SIGKILL');
  });
  try {
    await readPacketLines(child.stdout, tracks, signal);
    const code = await closed;
    if (processError) throw processError;
    if (code !== 0 || probeFailed) throw invalidVideo();
    signal.throwIfAborted();
    return measurePacketTiming(tracks);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
}

export async function probeUploadFile(localPath: string, mimeType: string, signal: AbortSignal) {
  const demuxer = mimeType === 'video/webm' ? 'matroska' : 'mov';
  const expiresAt = performance.now() + 8_000;
  const deadline = Object.assign(AbortSignal.any([signal, AbortSignal.timeout(8_000)]), {
    assertActive: () => {
      assertWorkActive(signal);
      if (performance.now() >= expiresAt) throw invalidVideo();
    },
  });
  assertWorkActive(deadline);
  const binary = await withinUploadDeadline(resolveYouTubeProbe, deadline);
  const input = [
    '-v', 'error', '-max_alloc', '33554432', '-protocol_whitelist', 'file', '-f', demuxer,
    ...(demuxer === 'mov' ? ['-enable_drefs', '0'] : []),
  ];
  try {
    const file = await withinUploadDeadline(() => stat(localPath).catch(() => { throw invalidVideo(); }), deadline);
    if (!file.isFile() || file.size < 1 || file.size > YOUTUBE_MAX_BYTES) throw invalidVideo();
    assertWorkActive(deadline);
    const { stdout } = await execute(binary, [
      ...input, '-of', 'json', '-show_entries',
      'format=duration:stream=index,codec_type,width,height,duration,time_base,sample_rate,sample_aspect_ratio:stream_disposition=attached_pic:stream_tags=rotate:stream_side_data_list',
      '-i', localPath,
    ], { maxBuffer: 128 * 1024, signal: deadline, killSignal: 'SIGKILL', windowsHide: true, env: probeEnvironment });
    const probe = readYouTubeProbe(JSON.parse(stdout));
    if (probe.hasCompleteDuration || demuxer !== 'matroska') {
      return measuredVideo(probe, probe.durationSeconds, probe.hasCompleteDuration);
    }
    assertWorkActive(deadline);
    const packets = await probeWebmPackets(binary, input, localPath, probe, deadline);
    return measuredVideo(
      probe, Math.max(probe.durationSeconds, packets.durationSeconds), packets.completeDuration, packets.withinShortsLimit,
    );
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if ((error as { code?: string }).code === 'ENOENT') throw error;
    throw invalidVideo();
  }
}

async function measure(jobKey: string, file: FileManifest, generation: string, signal: UploadWorkSignal) {
  if (file.size < 1 || file.size > YOUTUBE_MAX_BYTES) throw invalidVideo();
  await withinUploadDeadline(resolveYouTubeProbe, signal);
  const url = objectUrl(objectPath(jobKey), generation);
  url.searchParams.set('alt', 'media');
  const directory = await mkdtemp(join(tmpdir(), 'veloxa-youtube-'));
  try {
    const localPath = join(directory, 'source');
    const response = await storageRequest(url, {}, signal);
    if (!response.ok || !response.body) {
      await cancelBody(response);
      throw new StorageFailure(response.status);
    }
    let count = 0;
    const verifySize = new Transform({
      transform(chunk: Buffer, _, done) {
        count += chunk.byteLength;
        done(count > file.size ? new StorageFailure(502) : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), verifySize, createWriteStream(localPath, { mode: 0o600 }), { signal });
    if (count !== file.size) throw new StorageFailure(502);
    return await probeUploadFile(localPath, file.mimeType, signal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function read(jobKey: string, generation: string, start: number, end: number, total: number, signal: UploadWorkSignal) {
  const bytes = end - start + 1;
  if (start < 0 || end >= total || bytes < 1 || bytes > YOUTUBE_CHUNK_BYTES) throw new StorageFailure(400);
  const url = objectUrl(objectPath(jobKey), generation);
  url.searchParams.set('alt', 'media');
  const result = await storageRequest(url, { headers: { Range: `bytes=${start}-${end}` } }, signal);
  if (result.status !== 206 || result.headers.get('content-range') !== `bytes ${start}-${end}/${total}` || !result.body) {
    await cancelBody(result);
    throw new StorageFailure(result.status);
  }
  const body = result.body.getReader();
  const buffer = Buffer.allocUnsafe(bytes);
  let written = 0;
  try {
    for (;;) {
      const chunk = await body.read();
      if (chunk.done) break;
      if (written + chunk.value.byteLength > bytes) {
        void body.cancel().catch(() => {});
        throw new StorageFailure(502);
      }
      buffer.set(chunk.value, written);
      written += chunk.value.byteLength;
    }
  } finally {
    body.releaseLock();
  }
  if (written !== bytes) throw new StorageFailure(502);
  return buffer;
}

async function cleanup(jobKey: string, file: FileManifest, _chunks: Record<string, string>, _sourceGeneration: string | null, signal: AbortSignal) {
  const targets = [objectPath(jobKey), ...file.chunkHashes.map((hash, index) => objectPath(jobKey, index, hash))];
  // Every path belongs solely to this immutable operation. Delete its current live generation,
  // including an uncheckpointed generation created by a late conditional write after an earlier sweep.
  for (let index = 0; index < targets.length; index += 8) {
    await Promise.all(targets.slice(index, index + 8).map(async path => {
      const url = objectUrl(path);
      const result = await storageRequest(url, { method: 'DELETE' }, signal);
      await cancelBody(result);
      if (!result.ok && result.status !== 404) throw new StorageFailure(result.status);
    }));
  }
}

export const uploadMedia: UploadMedia = { stage, compose, measure, read, cleanup };
