import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable, Writable } from 'node:stream';
import sharp, { type OverlayOptions } from 'sharp';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { fitVideoText } from './content-compositor';
import { productionResources, type YouTubeScene, type YouTubeProductionSettings } from '../youtube-production';
import type { BrandProfile } from '../veloxa-types';

const exec = promisify(execFile);
const fps = 25;
export function sceneFrameCounts(durations: number[], targetSeconds: number) {
  if (durations.length !== 4 || durations.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Durasi adegan tidak valid.');
  const total = durations.reduce((sum, value) => sum + value, 0);
  let previous = 0, accumulated = 0;
  return durations.map((value, index) => {
    accumulated += value;
    const end = index === 3 ? Math.round(targetSeconds * fps) : Math.round(accumulated / total * targetSeconds * fps);
    const frames = end - previous; previous = end;
    if (frames < 25) throw new Error('Adegan terlalu pendek.');
    return frames;
  });
}
/** Reject busy/low-contrast photo space; never cover it with a dark card or wash. */
export async function composeYouTubeFrame(photo: Buffer, scene: YouTubeScene, settings: YouTubeProductionSettings, brand: BrandProfile) {
  const { width, height } = productionResources(settings);
  const vertical = settings.kind === 'short';
  const x = vertical ? 50 : 70, y = vertical ? 230 : 110, copyWidth = vertical ? 480 : 520;
  const raw = await sharp(photo).resize(width, height).removeAlpha().raw().toBuffer();
  // Include the full motion sweep, rather than measuring only the starting photo.
  const region = await sharp(raw, { raw: { width, height, channels: 3 } })
    .extract({ left: x - 8, top: y - 30, width: copyWidth + 72, height: vertical ? 530 : 440 }).resize(100, 80).raw().toBuffer();
  let darkest = 1, brightest = 0;
  const linear = (v: number) => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
  for (let i = 0; i < region.length; i += 3) {
    const l = .2126 * linear(region[i]) + .7152 * linear(region[i + 1]) + .0722 * linear(region[i + 2]);
    darkest = Math.min(darkest, l); brightest = Math.max(brightest, l);
  }
  const ink = (darkest + .05) / .05 >= 4.5 ? '#111111' : 1.05 / (brightest + .05) >= 4.5 ? '#FFFFFF' : null;
  if (!ink) throw new Error('Foto perlu ruang teks yang lebih tenang. Adegan ini akan diperbaiki.');
  const layers: OverlayOptions[] = [];
  const add = async (text: string, top: number, maxHeight: number, size: number, bold = false) => {
    const rendered = await fitVideoText(text, copyWidth, maxHeight, size, size, ink, bold);
    if (rendered) layers.push({ input: rendered.data, left: x, top });
    return rendered?.height ?? 0;
  };
  await add(brand.businessName, y, 60, vertical ? 25 : 26);
  const headlineTop = y + 85;
  const headlineHeight = await add(scene.title, headlineTop, vertical ? 230 : 210, vertical ? 56 : 54, true);
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accentColorHex) ? brand.accentColorHex : '#A92E5D';
  layers.push({ input: Buffer.from(`<svg width="${copyWidth}" height="16"><path d="M2 10 Q${copyWidth / 2} 0 ${copyWidth - 2} 10" fill="none" stroke="${accent}" stroke-width="6"/></svg>`), left: x, top: headlineTop + headlineHeight + 12 });
  await add(scene.supporting, headlineTop + headlineHeight + 55, vertical ? 200 : 150, vertical ? 30 : 30);
  const overlay = await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite(layers).png().toBuffer();
  const image = await sharp(photo).resize(width, height).composite([{ input: overlay }]).jpeg({ quality: 92 }).toBuffer();
  return { photo: await sharp(photo).resize(width, height).jpeg({ quality: 92 }).toBuffer(), overlay, image };
}

/** A bounded scene is encoded independently; long videos never accumulate decoded frames. */
export async function renderYouTubeScene(input: {
  photo: Buffer; overlay: Buffer; pcm: Buffer; frames: number; startFrame: number;
  index: number; kind: 'short' | 'video'; previousFrame?: Buffer;
}) {
  if (input.pcm.length < 48000 || input.pcm.length > 48000 * 90 || input.frames < 25 || input.frames > 25 * 70 || input.startFrame < 0) throw new Error('Media adegan tidak valid.');
  const width = input.kind === 'short' ? 720 : 1280, height = input.kind === 'short' ? 1280 : 720;
  const dir = await mkdtemp(path.join(tmpdir(), 'veloxa-youtube-scene-'));
  try {
    await Promise.all([writeFile(path.join(dir, 'photo.jpg'), input.photo), writeFile(path.join(dir, 'overlay.png'), input.overlay), writeFile(path.join(dir, 'audio.pcm'), input.pcm), ...(input.previousFrame ? [writeFile(path.join(dir, 'previous.jpg'), input.previousFrame)] : [])]);
    const ease = `(0.5-0.5*cos(PI*on/${Math.max(1, input.frames - 1)}))`;
    const mode = input.index % 4;
    const zoom = mode === 3 ? `1.09-.09*${ease}` : mode === 0 ? `1+.09*${ease}` : '1.09';
    const horizontal = mode === 1 ? ease : mode === 2 ? `1-${ease}` : '.5';
    const filters = [`[0:v]scale=${width * 2}:${height * 2},zoompan=z='${zoom}':x='(iw-iw/zoom)*(${horizontal})':y='(ih-ih/zoom)*.5':d=${input.frames}:s=${width}x${height}:fps=25,setsar=1[photo]`, '[photo][1:v]overlay=shortest=0:format=yuv420[composed]'];
    if (input.previousFrame) filters.push(`[3:v]loop=loop=-1:size=1:start=0,setpts=N/(25*TB)[old]`, '[composed]format=yuva420p,fade=t=in:st=0:d=0.32:alpha=1[incoming]', '[old][incoming]overlay=shortest=1:format=yuv420[video]');
    else filters.push('[composed]null[video]');
    const duration = input.frames / 25;
    const source = input.pcm.length / 48000;
    const tempo = source / duration;
    if (tempo < .72 || tempo > 1.35) throw new Error('Pembawaan suara perlu disesuaikan dengan durasi naskah.');
    await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_complex_threads', '1',
      '-i', path.join(dir, 'photo.jpg'), '-i', path.join(dir, 'overlay.png'), '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', path.join(dir, 'audio.pcm'),
      ...(input.previousFrame ? ['-i', path.join(dir, 'previous.jpg')] : []), '-filter_complex', filters.join(';'), '-map', '[video]', '-map', '2:a',
      '-frames:v', String(input.frames), '-af', `atempo=${tempo},apad,atrim=duration=${duration}`, '-t', String(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-threads', '2', '-r', '25', '-g', '50',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-output_ts_offset', String(input.startFrame / 25), '-muxdelay', '0', '-mpegts_copyts', '1', '-f', 'mpegts', path.join(dir, 'scene.ts')], { timeout: 80_000, maxBuffer: 128 * 1024 });
    await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.join(dir, 'scene.ts'), '-vf', `select=eq(n\\,${input.frames - 1})`, '-vsync', '0', '-frames:v', '1', path.join(dir, 'last.jpg')], { timeout: 15_000, maxBuffer: 128 * 1024 });
    return { ts: await readFile(path.join(dir, 'scene.ts')), last: await readFile(path.join(dir, 'last.jpg')), durationSeconds: duration };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Remux a continuous, timestamped TS stream into MP4 without loading a long video into memory. */
export async function remuxYouTubeVideo(source: Readable, destination: Writable, timeoutMs = 180_000) {
  const process = spawn(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts', '-f', 'mpegts', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const done = new Promise<void>((resolve, reject) => { process.once('error', reject); process.once('close', code => code === 0 ? resolve() : reject(new Error('Penggabungan video perlu dicoba kembali.'))); });
  process.stderr.resume();
  const timer = setTimeout(() => process.kill('SIGKILL'), timeoutMs);
  try { await Promise.all([pipeline(source, process.stdin), pipeline(process.stdout, destination), done]); }
  catch (error) { process.kill('SIGKILL'); source.destroy(); destination.destroy(); throw error; }
  finally { clearTimeout(timer); }
}
