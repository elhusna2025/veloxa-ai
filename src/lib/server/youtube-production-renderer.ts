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
export const YOUTUBE_LAYOUT_VERSION = 2;
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
export async function composeYouTubeFrame(photo: Buffer, scene: YouTubeScene, settings: YouTubeProductionSettings, brand: BrandProfile, sceneIndex = 0) {
  const { width, height } = productionResources(settings);
  const vertical = settings.kind === 'short';
  const x = vertical ? 50 : 70, y = vertical ? 230 : 110, copyWidth = vertical ? 480 : 520;
  const raw = await sharp(photo).resize(width, height).toColourspace('srgb').removeAlpha().raw().toBuffer();
  const linear = (v: number) => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
  // Fit first. Contrast applies to the actual lettering, not to unused space below
  // it or the subject beside it. The previous oversized rectangle rejected readable photos.
  const text: { rendered: NonNullable<Awaited<ReturnType<typeof fitVideoText>>>; top: number; samples: [number, number][] }[] = [];
  const add = async (value: string, top: number, maxHeight: number, size: number, bold = false) => {
    const rendered = await fitVideoText(value, copyWidth, maxHeight, size, size, '#FFFFFF', bold);
    if (rendered) {
      const mask = await sharp(rendered.data).extractChannel('alpha').raw().toBuffer();
      const samples: [number, number][] = [];
      for (let row = 0; row < rendered.height; row += 2) for (let col = 0; col < rendered.width; col += 2) if (mask[row * rendered.width + col] >= 170) samples.push([col, row]);
      text.push({ rendered, top, samples });
    }
    return rendered?.height ?? 0;
  };
  await add(brand.businessName, y, 60, vertical ? 25 : 26);
  const headlineTop = y + (vertical ? 60 : 85);
  const headlineHeight = await add(scene.title, headlineTop, vertical ? 230 : 210, vertical ? 48 : 54, true);
  await add(scene.supporting, headlineTop + headlineHeight + (vertical ? 32 : 55), vertical ? 200 : 150, 30);
  const mode = sceneIndex % 4;
  const inks = [brand.primaryColorHex, '#111111', '#FFFFFF'].filter(color => /^#[0-9a-f]{6}$/i.test(color));
  const luminance = (color: string) => .2126 * linear(parseInt(color.slice(1, 3), 16)) + .7152 * linear(parseInt(color.slice(3, 5), 16)) + .0722 * linear(parseInt(color.slice(5, 7), 16));
  let placement: { dx: number; dy: number; ink: string } | undefined;
  for (const [dx, dy] of [[0, 0], [0, -36], [0, 48], [32, 0], [32, 48], [0, 84]]) {
    if (text.some(block => x + dx + block.rendered.width > width - 70 || block.top + dy < (vertical ? 180 : 50) || block.top + dy + block.rendered.height > (vertical ? height - 320 : height - 50))) continue;
    let darkest = 1, brightest = 0;
    for (let time = 0; time <= 16; time++) {
      const progress = time / 16, zoom = mode === 3 ? 1.09 - .09 * progress : mode === 0 ? 1 + .09 * progress : 1.09;
      const horizontal = mode === 1 ? progress : mode === 2 ? 1 - progress : .5;
      for (const block of text) for (const [col, row] of block.samples) {
        const sx = Math.min(width - 1, Math.max(0, Math.round((x + dx + col) / zoom + width * (1 - 1 / zoom) * horizontal)));
        const sy = Math.min(height - 1, Math.max(0, Math.round((block.top + dy + row) / zoom + height * (1 - 1 / zoom) * .5)));
        const offset = (sy * width + sx) * 3;
        const light = .2126 * linear(raw[offset]) + .7152 * linear(raw[offset + 1]) + .0722 * linear(raw[offset + 2]);
        darkest = Math.min(darkest, light); brightest = Math.max(brightest, light);
      }
    }
    const ink = inks.find(color => { const light = luminance(color); return light <= darkest ? (darkest + .05) / (light + .05) >= 4.5 : light >= brightest && (light + .05) / (brightest + .05) >= 4.5; });
    if (ink) { placement = { dx, dy, ink }; break; }
  }
  if (!placement) throw new Error('Foto perlu ruang teks yang lebih tenang. Adegan ini akan diperbaiki.');
  const { dx, dy, ink } = placement;
  const layers: OverlayOptions[] = [];
  for (const block of text) {
    const mask = await sharp(block.rendered.data).extractChannel('alpha').raw().toBuffer();
    const rgba = await sharp({ create: { width: block.rendered.width, height: block.rendered.height, channels: 3, background: ink } }).joinChannel(mask, { raw: { width: block.rendered.width, height: block.rendered.height, channels: 1 } }).png().toBuffer();
    layers.push({ input: rgba, left: x + dx, top: block.top + dy });
  }
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accentColorHex) ? brand.accentColorHex : '#A92E5D';
  layers.push({ input: Buffer.from(`<svg width="${copyWidth}" height="16"><path d="M2 10 Q${copyWidth / 2} 0 ${copyWidth - 2} 10" fill="none" stroke="${accent}" stroke-width="6"/></svg>`), left: x + dx, top: headlineTop + headlineHeight + 12 + dy });
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
