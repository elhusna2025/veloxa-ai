import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import artifacts from '../../../scripts/youtube-ffprobe-artifacts.json';
import { ApiError } from './http';

const platform = `${process.platform}-${process.arch}` as keyof typeof artifacts;
let verification: Promise<string> | undefined;

export function youtubeProbeSupported() {
  return Object.hasOwn(artifacts, platform);
}

async function verifyInstalledProbe() {
  const artifact = artifacts[platform];
  if (!artifact) throw new Error('unsupported platform');
  const path = join(process.cwd(), 'node_modules', '.veloxa-youtube-ffprobe', platform, 'ffprobe');
  const info = await lstat(path);
  if (!info.isFile() || info.size !== artifact.binaryBytes) throw new Error('invalid binary size');
  await access(path, constants.X_OK | constants.R_OK);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  if (digest.digest('hex') !== artifact.binarySha256) throw new Error('invalid binary digest');
  return path;
}

export function resolveYouTubeProbe() {
  verification ??= verifyInstalledProbe().catch(() => {
    verification = undefined;
    throw new ApiError(503, 'Pemeriksa video YouTube belum tersedia. Coba kembali setelah layanan siap.', 'youtube_probe_unavailable');
  });
  return verification;
}
