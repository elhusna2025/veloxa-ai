'use strict';

const { spawn, execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { constants, createReadStream, createWriteStream } = require('node:fs');
const { access, chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const artifacts = require('./youtube-ffprobe-artifacts.json');

const run = promisify(execFile);
const maxArchiveBytes = 256 * 1024 * 1024;
const cacheRoot = join(__dirname, '..', 'node_modules', '.veloxa-youtube-ffprobe');
const platform = `${process.platform}-${process.arch}`;
const asset = artifacts[platform];
const allowedOrigins = new Set([
  'https://github.com',
  'https://release-assets.githubusercontent.com',
  'https://objects.githubusercontent.com',
  'https://ffmpeg.martin-riedl.de',
]);

async function sha256(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}

async function isInstalled(binary, license) {
  try {
    const file = await lstat(binary);
    if (!file.isFile() || file.size !== asset.binaryBytes) return false;
    await access(binary, constants.X_OK | constants.R_OK);
    await access(license, constants.R_OK);
    return await sha256(binary) === asset.binarySha256;
  } catch {
    return false;
  }
}

async function openArchive(raw, signal) {
  let url = new URL(raw);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    if (!allowedOrigins.has(url.origin) || url.username || url.password) throw new Error('Sumber unduhan FFprobe tidak berlaku.');
    const response = await fetch(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Pengalihan unduhan FFprobe tidak berlaku.');
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Unduhan FFprobe gagal (HTTP ${response.status}).`);
    }
    return Readable.fromWeb(response.body);
  }
  throw new Error('Terlalu banyak pengalihan unduhan FFprobe.');
}

async function collect(source, destination, expectedBytes, expectedSHA, signal) {
  const sha = createHash('sha256');
  let size = 0;
  const verify = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.byteLength;
      if (size > expectedBytes) return done(new Error('Ukuran artefak FFprobe melebihi batas.'));
      sha.update(chunk);
      done(null, chunk);
    },
  });
  await pipeline(source, verify, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
  if (size !== expectedBytes || sha.digest('hex') !== expectedSHA) throw new Error('Checksum artefak FFprobe tidak cocok.');
}

async function extract(archive, member, destination, size, checksum) {
  // The archive is verified first. Only fixed entries are written, through stdout to our files.
  const signal = AbortSignal.timeout(90_000);
  const [program, args] = asset.archiveType === 'zip' ? ['unzip', ['-p', archive, member]] : ['tar', ['-xOf', archive, member]];
  const command = spawn(program, args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'], signal });
  const closed = new Promise((resolve, reject) => {
    command.once('error', reject);
    command.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Ekstraksi artefak FFprobe gagal (${program}).`));
    });
  });
  try {
    await Promise.all([collect(command.stdout, destination, size, checksum, signal), closed]);
  } catch (error) {
    command.kill();
    await closed.catch(() => {});
    throw error;
  }
}

async function install() {
  if (!asset) {
    console.info(`FFprobe unggahan YouTube belum disediakan untuk ${platform}.`);
    return;
  }
  if (asset.archiveBytes < 1 || asset.archiveBytes > maxArchiveBytes) throw new Error('Ukuran arsip FFprobe tidak berlaku.');
  const target = join(cacheRoot, platform);
  const binary = join(target, 'ffprobe');
  const license = join(target, 'LICENSE.txt');
  await mkdir(target, { recursive: true });
  if (await isInstalled(binary, license)) {
    console.info(`FFprobe YouTube ${asset.version} sudah terverifikasi.`);
    return;
  }

  const directory = await mkdtemp(join(target, '.install-'));
  try {
    const archive = join(directory, `ffprobe.${asset.archiveType}`);
    const candidate = join(directory, 'ffprobe');
    const notice = join(directory, 'LICENSE.txt');
    const signal = AbortSignal.timeout(180_000);
    await collect(await openArchive(asset.url, signal), archive, asset.archiveBytes, asset.archiveSha256, signal);
    await extract(archive, asset.member, candidate, asset.binaryBytes, asset.binarySha256);
    await chmod(candidate, 0o755);
    const { stdout } = await run(candidate, ['-version'], { env: { LC_ALL: 'C' }, maxBuffer: 16 * 1024, timeout: 8000 });
    if (stdout.trimStart().split(/\s+/)[2] !== asset.version) throw new Error('Versi FFprobe tidak cocok dengan rilis yang dipatok.');
    if (asset.license) {
      await extract(archive, asset.license.member, notice, asset.license.bytes, asset.license.sha256);
    } else {
      const { stdout: terms } = await run(candidate, ['-L'], { env: { LC_ALL: 'C' }, maxBuffer: 32 * 1024, timeout: 8000 });
      await writeFile(notice, `${asset.url}\n${asset.source}\n\n${terms}`, { flag: 'wx' });
    }
    await chmod(notice, 0o644);
    await rename(notice, license);
    await rename(candidate, binary);
    console.info(`FFprobe YouTube ${asset.version} dipasang dan diverifikasi.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

install().catch(error => {
  console.error(`Pemasangan FFprobe YouTube gagal. ${error instanceof Error ? error.message : 'Periksa unduhan dan platform.'}`);
  process.exitCode = 1;
});
