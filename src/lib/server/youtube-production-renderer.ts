import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
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
export const YOUTUBE_LAYOUT_VERSION = 3;
export function sceneFrameCounts(durations: number[], targetSeconds: number) {
  if (!durations.length || durations.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Durasi adegan tidak valid.');
  const total = durations.reduce((sum, value) => sum + value, 0);
  let previous = 0, accumulated = 0;
  return durations.map((value, index) => {
    accumulated += value;
    const end = index === durations.length - 1 ? Math.round(targetSeconds * fps) : Math.round(accumulated / total * targetSeconds * fps);
    const frames = end - previous; previous = end;
    if (frames < 1) throw new Error('Adegan terlalu pendek.');
    return frames;
  });
}
/** Reject busy/low-contrast photo space; never cover it with a dark card or wash. */
export async function composeYouTubeFrame(photo: Buffer, scene: YouTubeScene, settings: YouTubeProductionSettings, brand: BrandProfile, sceneIndex = 0, narrativeComposition = false) {
  const { width, height } = productionResources(settings);
  if (narrativeComposition) {
    const image = await sharp(photo).resize(width, height).jpeg({ quality: 92 }).toBuffer();
    const overlay = await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).png().toBuffer();
    return { photo: image, overlay, image };
  }
  const vertical = settings.kind === 'short';
  const x = vertical ? 50 : 70, y = vertical ? 230 : 110, copyWidth = vertical ? 480 : 540;
  const raw = await sharp(photo).resize(width, height).toColourspace('srgb').removeAlpha().raw().toBuffer();
  const linear = Array.from({ length: 256 }, (_, byte) => {
    const n = byte / 255;
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
  });
  const light = new Float32Array(width * height);
  for (let i = 0; i < light.length; i++) {
    light[i] = .2126 * linear[raw[3 * i]] + .7152 * linear[raw[3 * i + 1]] + .0722 * linear[raw[3 * i + 2]];
  }
  // Fit first. Contrast applies to the actual lettering, not to unused space below
  // it or the subject beside it. The previous oversized rectangle rejected readable photos.
  const text: { rendered: NonNullable<Awaited<ReturnType<typeof fitVideoText>>>; top: number; samples: [number, number][] }[] = [];
  const add = async (value: string, top: number, maxHeight: number, size: number, bold = false, minSize = size) => {
    const rendered = await fitVideoText(value, copyWidth, maxHeight, size, minSize, '#FFFFFF', bold);
    if (rendered) {
      const mask = await sharp(rendered.data).extractChannel('alpha').raw().toBuffer();
      const samples: [number, number][] = [];
      for (let row = 0; row < rendered.height; row += 2) for (let col = 0; col < rendered.width; col += 2) if (mask[row * rendered.width + col] >= 170) samples.push([col, row]);
      text.push({ rendered, top, samples });
    }
    return rendered?.height ?? 0;
  };
  const headlineTop = y;
  const headlineHeight = await add(scene.title, headlineTop, vertical ? 230 : 210, vertical ? 48 : 54, true);
  await add(scene.supporting, headlineTop + headlineHeight + (vertical ? 32 : 55), 220, vertical ? 36 : 42, false, 30);
  const mode = sceneIndex % 4;
  const primary = /^#[0-9a-f]{6}$/i.test(brand.primaryColorHex) ? brand.primaryColorHex : '#20548A';
  const deepBrand = '#' + [1, 3, 5].map(index => Math.round(parseInt(primary.slice(index, index + 2), 16) * .24).toString(16).padStart(2, '0')).join('');
  const inks = [...new Set([primary, ...(brand.additionalColorHexes ?? []), deepBrand, '#FFFFFF', '#000000'])]
    .filter(color => /^#[0-9a-f]{6}$/i.test(color)).map(color => ({
      color, value: .2126 * linear[parseInt(color.slice(1, 3), 16)] + .7152 * linear[parseInt(color.slice(3, 5), 16)] + .0722 * linear[parseInt(color.slice(5, 7), 16)],
    }));
  // Cache the camera's source coordinates. Search within the space reserved for
  // lettering, leaving the subject on the other side of the frame.
  const sweep = Array.from({ length: 17 }, (_, t) => {
    const progress = t / 16;
    const zoom = mode === 3 ? 1.09 - .09 * progress : mode === 0 ? 1 + .09 * progress : 1.09;
    const horizontal = mode === 1 ? progress : mode === 2 ? 1 - progress : .5;
    return {
      cols: Int32Array.from({ length: width }, (_, n) => Math.round(n / zoom + width * (1 - 1 / zoom) * horizontal)),
      rows: Int32Array.from({ length: height }, (_, n) => width * Math.round(n / zoom + height * (1 - 1 / zoom) * .5)),
    };
  });
  function readableInk(block: typeof text[number], left: number, top: number, contrast: number, palette: typeof inks) {
    let min = 1, max = 0;
    const readable = (ink: typeof inks[number]) => (min + .05) >= contrast * (ink.value + .05) || (ink.value + .05) >= contrast * (max + .05);
    for (const { rows, cols } of sweep) {
      for (const [col, row] of block.samples) {
        const pixel = rows[top + row] + cols[left + col];
        // Include the area around the stroke, where texture can obscure thin letters at phone size.
        const nearMin = Math.min(light[pixel], light[pixel - 4], light[pixel + 4], light[pixel - 4 * width], light[pixel + 4 * width]);
        const nearMax = Math.max(light[pixel], light[pixel - 4], light[pixel + 4], light[pixel - 4 * width], light[pixel + 4 * width]);
        if (nearMin < min || nearMax > max) {
          min = Math.min(min, nearMin); max = Math.max(max, nearMax);
          if (!palette.some(readable)) return;
        }
      }
    }
    return palette.find(readable)?.color;
  }
  const safeTop = vertical ? 180 : 48, safeBottom = height - (vertical ? 320 : 48);
  type Placed = { top: number; ink: string; block: typeof text[number] };
  // Try the original spacing first, then compact spacing. A horizon, doorway,
  // or other feature may fall in the gap between the title and its explanation.
  function findPlacement(contrast: number, palette: typeof inks) {
    for (const left of [x, x - 16, x + 24]) {
      const checked = text.map(() => new Map<number, string | undefined>());
      for (const start of [y, ...Array.from({ length: Math.ceil((safeBottom - safeTop) / 24) }, (_, i) => safeTop + 24 * i)]) {
        const blocks: Placed[] = [];
        let next = start;
        for (const [i, block] of text.entries()) {
          const preferred = i === 0 ? start : Math.max(next, start + block.top - y);
          const options = [preferred, ...Array.from({ length: 8 }, (_, n) => next + 16 * n)];
          for (const top of options) {
            if (top + block.rendered.height > safeBottom) continue;
            if (!checked[i].has(top)) checked[i].set(top, readableInk(block, left, top, contrast, palette));
            const ink = checked[i].get(top);
            if (!ink) continue;
            blocks.push({ block, ink, top });
            next = top + block.rendered.height + (block.top === headlineTop ? 32 : 16);
            break;
          }
          if (blocks.length !== i + 1) break;
        }
        if (blocks.length === text.length) return { left, blocks };
      }
    }
  }
  const preferredInks = inks.filter(ink => ink.color !== '#000000');
  const placement = findPlacement(7, preferredInks) ?? findPlacement(4.5, preferredInks) ?? findPlacement(4.5, inks);
  if (!placement) throw new Error('Foto perlu ruang teks yang lebih tenang. Adegan ini akan diperbaiki.');
  const layers: OverlayOptions[] = [];
  for (const { block, top, ink } of placement.blocks) {
    const mask = await sharp(block.rendered.data).extractChannel('alpha').raw().toBuffer();
    const rgba = await sharp({ create: { width: block.rendered.width, height: block.rendered.height, channels: 3, background: ink } }).joinChannel(mask, { raw: { width: block.rendered.width, height: block.rendered.height, channels: 1 } }).png().toBuffer();
    layers.push({ input: rgba, left: placement.left, top });
  }
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accentColorHex) ? brand.accentColorHex : '#A92E5D';
  layers.push({ input: Buffer.from(`<svg width="${copyWidth}" height="16"><path d="M2 10 Q${copyWidth / 2} 0 ${copyWidth - 2} 10" fill="none" stroke="${accent}" stroke-width="6"/></svg>`), left: placement.left, top: (placement.blocks.find(item => item.block.top === headlineTop)?.top ?? headlineTop) + headlineHeight + 8 });
  const overlay = await sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite(layers).png().toBuffer();
  const image = await sharp(photo).resize(width, height).composite([{ input: overlay }]).jpeg({ quality: 92 }).toBuffer();
  return { photo: await sharp(photo).resize(width, height).jpeg({ quality: 92 }).toBuffer(), overlay, image };
}

/** Flush the complete utterance before encoding video; -frames:v must never truncate speech. */
export async function normalizeYouTubeSceneAudio(pcm: Buffer, frames: number) {
  if (!pcm.length || pcm.length % 2 || pcm.length > 48000 * 90 || !Number.isSafeInteger(frames) || frames < 1 || frames > 25 * 70) throw new Error('Audio adegan tidak valid.');
  const sourceSeconds = pcm.length / 48000, tempo = sourceSeconds / (frames / fps);
  if (tempo < .72 || tempo > 1.35) throw new Error('Pembawaan suara perlu disesuaikan dengan durasi naskah.');
  const dir = await mkdtemp(path.join(tmpdir(), 'veloxa-youtube-audio-'));
  try {
    await writeFile(path.join(dir, 'source.pcm'), pcm);
    const samples = frames * (24000 / fps);
    await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', path.join(dir, 'source.pcm'),
      '-af', `${tempo === 1 ? '' : `atempo=${tempo},`}apad=whole_len=${samples},atrim=end_sample=${samples}`, '-f', 's16le', '-ar', '24000', '-ac', '1', path.join(dir, 'timed.pcm')], { timeout: 20_000, maxBuffer: 128 * 1024 });
    const audio = await readFile(path.join(dir, 'timed.pcm'));
    if (audio.length !== samples * 2) throw new Error('Durasi audio adegan belum sesuai gambar.');
    return audio;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Allocate short readable phrases within the measured utterance. */
export function sceneSubtitles(text: string, frames: number, width: number, height: number) {
  // Strip ASS overrides and hard-break escapes from incoming script text.
  const words = text.replace(/[{}\\]/gu, '').trim().split(/\s+/u).filter(Boolean);
  const groups: string[] = [];
  let phrase = '';
  const max = width < height ? 22 : 35;
  for (const word of words) {
    if (phrase && (phrase.length + word.length + 1 > max || /[.,!?…]$/u.test(phrase))) {
      groups.push(phrase); phrase = '';
    }
    phrase = phrase ? phrase + ' ' + word : word;
  }
  if (phrase) groups.push(phrase);
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  const stamp = (cs: number) => `0:${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  let consumed = 0;
  const events = groups.map(group => {
    const start = Math.round(frames * 4 * consumed / total);
    consumed += group.length;
    const end = Math.round(frames * 4 * consumed / total);
    return `Dialogue: 0,${stamp(start)},${stamp(end)},Speech,,0,0,0,,${group}`;
  });
  return [
    '[Script Info]', 'ScriptType: v4.00+', 'ScaledBorderAndShadow: yes', `PlayResX: ${width}`, `PlayResY: ${height}`,
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Speech,Inter ExtraBold,${width < height ? 47 : 51},&H00F6FAFF,&H00F6FAFF,&H00252321,&H60000000,-1,0,0,0,100,100,0,0,1,3,1,2,50,50,${width < height ? 235 : 58},1`,
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events, '',
  ].join('\n');
}

/** Video and lossless timed audio are checkpointed separately. AAC is encoded once at final merge. */
export async function renderYouTubeScene(input: {
  photo: Buffer; overlay: Buffer; pcm: Buffer; frames: number; startFrame: number;
  index: number; kind: 'short' | 'video'; previousFrame?: Buffer; caption?: string;
}) {
  if (!Number.isSafeInteger(input.frames) || input.frames < 1 || input.frames > 25 * 70 || !Number.isSafeInteger(input.startFrame) || input.startFrame < 0) throw new Error('Media adegan tidak valid.');
  const audio = await normalizeYouTubeSceneAudio(input.pcm, input.frames);
  const width = input.kind === 'short' ? 720 : 1280, height = input.kind === 'short' ? 1280 : 720;
  const dir = await mkdtemp(path.join(tmpdir(), 'veloxa-youtube-scene-'));
  try {
    await Promise.all([writeFile(path.join(dir, 'photo.jpg'), input.photo), writeFile(path.join(dir, 'overlay.png'), input.overlay), ...(input.previousFrame ? [writeFile(path.join(dir, 'previous.jpg'), input.previousFrame)] : [])]);
    const ease = `(0.5-0.5*cos(PI*on/${Math.max(1, input.frames - 1)}))`;
    const mode = input.index % 4;
    const zoom = mode === 3 ? `1.09-.09*${ease}` : mode === 0 ? `1+.09*${ease}` : '1.09';
    const horizontal = mode === 1 ? ease : mode === 2 ? `1-${ease}` : '.5';
    const filters = [`[0:v]scale=${width * 2}:${height * 2},zoompan=z='${zoom}':x='(iw-iw/zoom)*(${horizontal})':y='(ih-ih/zoom)*.5':d=${input.frames}:s=${width}x${height}:fps=25,setsar=1[photo]`, '[photo][1:v]overlay=shortest=0:format=yuv420[composed]'];
    if (input.previousFrame) filters.push(`[2:v]loop=loop=-1:size=1:start=0,setpts=N/(25*TB)[old]`, '[composed]format=yuva420p,fade=t=in:st=0:d=0.32:alpha=1[incoming]', '[old][incoming]overlay=shortest=1:format=yuv420[video]');
    else filters.push('[composed]null[video]');
    if (input.caption) {
      await Promise.all([
        writeFile(path.join(dir, 'speech.ass'), sceneSubtitles(input.caption, input.frames, width, height)),
        copyFile(path.join(process.cwd(), 'src/lib/server/fonts/inter/Inter-ExtraBold.ttf'), path.join(dir, 'voice.ttf')),
      ]);
      filters.push('[video]split[clean][speech]', `[clean]select=eq(n\\,${input.frames - 1})[last]`, '[speech]ass=speech.ass:fontsdir=.[captioned]');
    }
    const duration = input.frames / 25;
    await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-filter_complex_threads', '1',
      '-i', path.join(dir, 'photo.jpg'), '-i', path.join(dir, 'overlay.png'),
      ...(input.previousFrame ? ['-i', path.join(dir, 'previous.jpg')] : []), '-filter_complex', filters.join(';'), '-map', input.caption ? '[captioned]' : '[video]',
      '-frames:v', String(input.frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-threads', '2', '-r', '25', '-g', '50', '-bf', '0',
      '-output_ts_offset', String(input.startFrame / 25), '-muxdelay', '0', '-mpegts_copyts', '1', '-f', 'mpegts', path.join(dir, 'scene.ts'),
      ...(input.caption ? ['-map', '[last]', '-frames:v', '1', path.join(dir, 'last.jpg')] : [])], { cwd: dir, timeout: 80_000, maxBuffer: 128 * 1024 });
    if (!input.caption) await exec(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', path.join(dir, 'scene.ts'), '-vf', `select=eq(n\\,${input.frames - 1})`, '-vsync', '0', '-frames:v', '1', path.join(dir, 'last.jpg')], { timeout: 15_000, maxBuffer: 128 * 1024 });
    return { ts: await readFile(path.join(dir, 'scene.ts')), audio, last: await readFile(path.join(dir, 'last.jpg')), durationSeconds: duration };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Remux a continuous, timestamped TS stream into MP4 without loading a long video into memory. */
export async function remuxYouTubeVideo(source: Readable, audio: Readable, destination: Writable, frames: number, timeoutMs = 180_000) {
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 120 * 60 * fps) throw new Error('Durasi video tidak valid.');
  const process = spawn(ffmpeg.path, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts', '-f', 'mpegts', '-i', 'pipe:0', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:3',
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-t', String(frames / fps),
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  const done = new Promise<void>((resolve, reject) => { process.once('error', reject); process.once('close', code => code === 0 ? resolve() : reject(new Error('Penggabungan video perlu dicoba kembali.'))); });
  process.stderr.resume();
  const timer = setTimeout(() => process.kill('SIGKILL'), timeoutMs);
  try { await Promise.all([pipeline(source, process.stdin), pipeline(audio, process.stdio[3] as Writable), pipeline(process.stdout, destination), done]); }
  catch (error) { process.kill('SIGKILL'); source.destroy(); audio.destroy(); destination.destroy(); throw error; }
  finally { clearTimeout(timer); }
}
