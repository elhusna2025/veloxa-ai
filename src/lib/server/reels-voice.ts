import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { ApiError } from './http';
import { REELS_SPEC, reelsWordCount } from '../reels-spec';
import { DEFAULT_CONTENT_MODELS } from '../admin-settings';

export const REELS_VOICE_MODEL = DEFAULT_CONTENT_MODELS.voiceModel;
export const REELS_VOICE_DISCLOSURE = 'Voiceover menggunakan suara AI.';

const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;
const MAX_AUDIO_BYTES = REELS_SPEC.maxSourceAudioSeconds * SAMPLE_RATE * BYTES_PER_SAMPLE;
const MIN_AUDIO_SAMPLES = REELS_SPEC.minDurationSeconds * SAMPLE_RATE;
const DEFAULT_TIMEOUT_MS = 90_000;
const SCENES_PER_BATCH = 2;
const SCENE_LEAD_SAMPLES = Math.round(0.28 * SAMPLE_RATE);
const SCENE_TAIL_SAMPLES = Math.round(0.32 * SAMPLE_RATE);
const MAX_NARRATION_GAIN = 10 ** (6 / 20);
const NARRATION_PEAK = Math.floor(32767 * 10 ** (-2 / 20));
const SAFE_VOICE_ERROR = new ApiError(503, 'Voiceover Reels belum dapat dibuat. Silakan coba lagi.', 'reels_voice_unavailable');
const INVALID_SCRIPT_ERROR = new ApiError(400, `Skrip Reels harus berisi ${REELS_SPEC.minVoiceWords}–${REELS_SPEC.maxVoiceWords} kata dan maksimal ${REELS_SPEC.maxScriptChars.toLocaleString('id-ID')} karakter.`, 'invalid_reels_script');
const CONVERSATIONAL_VOICE = 'Ucapkan hanya naskah pengguna persis dalam Bahasa Indonesia. Gunakan suara percakapan yang hangat dan dekat, seperti mengobrol santai langsung dengan satu orang. Gabungkan kata menjadi frasa percakapan utuh. Variasikan intonasi dengan halus, gunakan jeda singkat saat berganti pikiran, dan pertahankan pelafalan yang jelas. Hindari penekanan seragam, jeda panjang, efek suara, dan gaya penyiar atau iklan.';
const SCENE_DELIVERY = [
  'Buka dengan rasa ingin tahu. Jika naskah dimulai dengan pertanyaan, beri intonasi tanya yang halus, lalu lanjutkan dengan nada akrab.',
  'Jelaskan langkah dengan tenang. Tekankan satu kata kunci secara halus dan sambungkan frasa berikutnya tanpa berhenti di setiap kata.',
  'Bawakan contoh atau detail berikutnya seolah sedang membantu satu orang. Beri jeda singkat setelah satu gagasan selesai.',
  'Tutup dengan nada hangat dan penuh dukungan. Bawakan kalimat terakhir dengan ritme santai dan akhiri tanpa menambah kata.',
] as const;
const INDONESIAN_LETTER_NAMES = [
  'a', 'be', 'ce', 'de', 'e', 'ef', 'ge', 'ha', 'i', 'je', 'ka', 'el', 'em',
  'en', 'o', 'pe', 'ki', 'er', 'es', 'te', 'u', 've', 'we', 'eks', 'ye', 'zet',
] as const;
const DIGIT_NAMES = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
const NUMBER_SCALES = new Map([['ribu', 1_000], ['juta', 1_000_000], ['miliar', 1_000_000_000], ['triliun', 1_000_000_000_000]]);

interface VoiceConnection {
  on(event: string, listener: (value?: unknown) => void): this;
  send(event: Record<string, unknown>): void;
  close(): void;
  socket: {
    on(event: string, listener: (...values: unknown[]) => void): unknown;
  };
}

interface VoiceDependencies {
  createConnection?: (model: string) => VoiceConnection;
  timeoutMs?: number;
  model?: string;
  sceneLines?: readonly string[];
  voice?: 'marin' | 'cedar' | 'coral' | 'ash' | 'sage' | 'shimmer' | 'echo' | 'alloy' | 'ballad' | 'verse';
  delivery?: string;
}

interface Voiceover {
  pcm: Buffer;
  sampleRate: typeof SAMPLE_RATE;
  transcript: string;
  model: string;
  sceneDurations?: number[];
}

function isValidScript(script: string): boolean {
  if (typeof script !== 'string' || script.trim().length === 0 || script.length > REELS_SPEC.maxScriptChars) return false;
  const words = reelsWordCount(script);
  return words >= REELS_SPEC.minVoiceWords && words <= REELS_SPEC.maxVoiceWords;
}

function safeBase64Buffer(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4 * Math.ceil(MAX_AUDIO_BYTES / 3) || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value ? decoded : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function productionConnection(model: string): VoiceConnection {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw SAFE_VOICE_ERROR;
  const client = new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', maxRetries: 0 });
  return new OpenAIRealtimeWS(
    { model, options: { maxPayload: 2 * 1024 * 1024 } },
    client,
  ) as unknown as VoiceConnection;
}

export async function generateReelsVoiceover(
  script: string,
  deps: VoiceDependencies = {},
): Promise<Voiceover> {
  if (!isValidScript(script)) throw INVALID_SCRIPT_ERROR;
  if (deps.sceneLines === undefined) {
    const instructions = `${CONVERSATIONAL_VOICE} Sesuaikan panjang pembacaan untuk durasi ${REELS_SPEC.minDurationSeconds}–${REELS_SPEC.maxDurationSeconds} detik tanpa menambah kata.`;
    return requestVoice(script, instructions, deps);
  }

  const lines = deps.sceneLines;
  if (!Array.isArray(lines) || lines.length !== REELS_SPEC.sceneCount ||
    !Array.from(lines).every(line => typeof line === 'string' && line.length <= REELS_SPEC.maxSceneVoiceChars && reelsWordCount(line) > 0) ||
    lines.join(' ').trim().replace(/\s+/g, ' ') !== script.trim().replace(/\s+/g, ' ')) {
    throw INVALID_SCRIPT_ERROR;
  }
  return generateSceneVoiceover(lines, deps);
}

function readSmallInteger(words: string[], start: number) {
  let next = start;
  let value = 0;
  const hundreds = DIGIT_NAMES.indexOf(words[next]);
  if (words[next] === 'seratus') { value = 100; next++; }
  else if (hundreds > 0 && words[next + 1] === 'ratus') { value = hundreds * 100; next += 2; }

  const units = DIGIT_NAMES.indexOf(words[next]);
  if (words[next] === 'sepuluh' || words[next] === 'sebelas') {
    value += words[next] === 'sepuluh' ? 10 : 11;
    next++;
  } else if (units >= 2 && words[next + 1] === 'belas') {
    value += 10 + units;
    next += 2;
  } else if (units > 0 && words[next + 1] === 'puluh') {
    value += units * 10;
    next += 2;
    const last = DIGIT_NAMES.indexOf(words[next]);
    if (last > 0) { value += last; next++; }
  } else if (units >= 0 && (units > 0 || next === start)) {
    value += units;
    next++;
  }
  return next > start ? { value, next } : null;
}

function readSpokenNumber(words: string[], start: number) {
  const first = words[start];
  if (first === undefined) return null;
  // Indonesian written amounts use dots for digit grouping and a comma for decimals.
  if (/^-?(0|[1-9]\d*)(,\d+)?$/.test(first) || /^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(first)) {
    const [integer, fraction = ''] = first.replace(/\./g, '').split(',');
    return { integer, fraction, next: start + 1 };
  }

  const negative = first === 'minus' || first === 'negatif';
  let next = start + Number(negative);
  let value = 0;
  let previousScale = Number.POSITIVE_INFINITY;
  let parsed = false;
  for (let part = readSmallInteger(words, next); part; part = readSmallInteger(words, next)) {
    parsed = true;
    next = part.next;
    const scale = NUMBER_SCALES.get(words[next]);
    if (!scale || scale >= previousScale || part.value === 0) { value += part.value; break; }
    value += part.value * scale;
    previousScale = scale;
    next++;
  }
  if (!parsed) return null;

  let fraction = '';
  if (words[next] === 'koma') {
    let end = next + 1;
    for (let digit = DIGIT_NAMES.indexOf(words[end]); digit >= 0; digit = DIGIT_NAMES.indexOf(words[end])) {
      fraction += digit;
      end++;
    }
    if (fraction.length > 0) next = end;
  }
  return { integer: `${negative ? '-' : ''}${value}`, fraction, next };
}

function spokenWords(text: string): string[] {
  const words = text.normalize('NFKC').replace(/\u2212/gu, '-')
    .replace(/\brp(?=-?\d)/giu, '$& ').replace(/\bse(ribu|juta|miliar|triliun)\b/giu, 'satu $1')
    .match(/-?\d+(?:[.,]\d+)*|[\p{L}\p{N}]+|%/gu) ?? [];
  const lower = words.map(word => word.toLocaleLowerCase('id-ID'));
  const canonical: string[] = [];
  for (let index = 0; index < words.length;) {
    const currencyPrefix = lower[index] === 'rp';
    const number = readSpokenNumber(lower, index + Number(currencyPrefix));
    if (!number) { canonical.push(words[index] === '%' ? 'persen' : words[index]); index++; continue; }
    const currencySuffix = lower[number.next] === 'rupiah';
    const fraction = number.fraction.replace(/0+$/, '');
    canonical.push(`${currencyPrefix || currencySuffix ? 'rp:' : '#'}${number.integer}${fraction ? `.${fraction}` : ''}`);
    index = number.next + Number(currencySuffix);
  }
  return canonical;
}

function matchesSpokenScript(expected: string[], transcript: string): boolean {
  // Audio transcripts can use either an acronym or its spoken Indonesian letter names.
  const actual = spokenWords(transcript.toLocaleLowerCase('id-ID'));
  let position = 0;
  for (const word of expected) {
    const lower = word.toLocaleLowerCase('id-ID');
    if (lower === actual[position]) { position++; continue; }
    if (!/^[A-Z]{2,8}$/.test(word)) return false;
    const letters = [...lower];
    const names = Array.from(word, letter => INDONESIAN_LETTER_NAMES[letter.charCodeAt(0) - 65]);
    if (!letters.every((letter, offset) => letter === actual[position + offset]) &&
      !names.every((name, offset) => name === actual[position + offset])) return false;
    position += letters.length;
  }
  return position === actual.length;
}

function applyNarrationGain(pcm: Buffer): void {
  let peak = 0;
  for (let offset = 0; offset < pcm.length; offset += BYTES_PER_SAMPLE) {
    peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
  }
  if (peak === 0) return;
  // One gain for the entire Reel keeps the relative levels and delivery of each scene.
  const gain = Math.min(MAX_NARRATION_GAIN, NARRATION_PEAK / peak);
  if (gain === 1) return;
  for (let offset = 0; offset < pcm.length; offset += BYTES_PER_SAMPLE) {
    pcm.writeInt16LE(Math.round(pcm.readInt16LE(offset) * gain), offset);
  }
}

async function generateSceneVoiceover(lines: readonly string[], deps: VoiceDependencies): Promise<Voiceover> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const scenes: Voiceover[] = [];

  async function narrate(line: string, index: number): Promise<Voiceover> {
    const direction = SCENE_DELIVERY[index];
    const instructions = `${CONVERSATIONAL_VOICE} ${direction} Mulai langsung dari kata pertama naskah. Jangan menyisipkan pengantar, sapaan, atau penutup tambahan. ${deps.delivery ? `Arahan pembawaan (bukan naskah): ${deps.delivery.slice(0, 800)}` : ''}`;
    const expected = spokenWords(line);
    const scene = await requestVoice(line, instructions, deps, controller.signal);
    if (matchesSpokenScript(expected, scene.transcript)) return scene;
    const corrected = await requestVoice(line, `${instructions} Pertahankan setiap kata dan urutannya.`, deps, controller.signal);
    if (matchesSpokenScript(expected, corrected.transcript)) return corrected;
    throw SAFE_VOICE_ERROR;
  }

  try {
    for (let offset = 0; offset < lines.length; offset += SCENES_PER_BATCH) {
      const batch = lines.slice(offset, offset + SCENES_PER_BATCH);
      scenes.push(...await Promise.all(batch.map((line, index) => narrate(line.trim(), offset + index))));
    }

    const lead = Buffer.alloc(SCENE_LEAD_SAMPLES * BYTES_PER_SAMPLE);
    const sceneSamples = scenes.map(scene => scene.pcm.length / BYTES_PER_SAMPLE + SCENE_LEAD_SAMPLES + SCENE_TAIL_SAMPLES);
    const totalSamples = sceneSamples.reduce((sum, samples) => sum + samples, 0);
    if (totalSamples * BYTES_PER_SAMPLE > MAX_AUDIO_BYTES) throw SAFE_VOICE_ERROR;
    const additionalSamples = Math.max(0, MIN_AUDIO_SAMPLES - totalSamples);
    const buffers: Buffer[] = [];
    const sceneDurations = scenes.map((scene, index) => {
      const extra = Math.floor(additionalSamples * (index + 1) / scenes.length) - Math.floor(additionalSamples * index / scenes.length);
      buffers.push(lead, scene.pcm, Buffer.alloc((SCENE_TAIL_SAMPLES + extra) * BYTES_PER_SAMPLE));
      return (sceneSamples[index] + extra) / SAMPLE_RATE;
    });
    const pcm = Buffer.concat(buffers);
    applyNarrationGain(pcm);
    return {
      pcm, sampleRate: SAMPLE_RATE, sceneDurations,
      transcript: scenes.map(scene => scene.transcript.trim()).join(' '), model: scenes[0].model,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Preserve one voice binding per speaker while timing the actual dialogue of each scene. */
export async function generateDialogueVoiceover(
  scenes: { lines: { text: string; voice: NonNullable<VoiceDependencies['voice']>; delivery: string }[] }[],
  deps: VoiceDependencies = {},
): Promise<Voiceover> {
  const script = scenes.flatMap(scene => scene.lines.map(line => line.text)).join(' ');
  if (!scenes.length || scenes.some(scene => !scene.lines.length || scene.lines.length > 6) || !isValidScript(script)) throw INVALID_SCRIPT_ERROR;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const buffers: Buffer[][] = scenes.map(() => []);
  const lines = scenes.flatMap((scene, index) => scene.lines.map(line => ({ ...line, index })));
  try {
    for (let offset = 0; offset < lines.length; offset += 2) {
      const batch = await Promise.all(lines.slice(offset, offset + 2).map(async line => {
        const instructions = `${CONVERSATIONAL_VOICE} Ucapkan hanya dialog ini. Karakter dan pembawaan: ${line.delivery.slice(0, 800)}. Jangan menambah kata atau menyebut nama pemeran sebagai label.`;
        const options = { ...deps, voice: line.voice };
        let spoken = await requestVoice(line.text, instructions, options, controller.signal);
        if (!matchesSpokenScript(spokenWords(line.text), spoken.transcript)) spoken = await requestVoice(line.text, instructions + ' Pertahankan setiap kata persis dan berurutan.', options, controller.signal);
        if (!matchesSpokenScript(spokenWords(line.text), spoken.transcript)) throw SAFE_VOICE_ERROR;
        return { index: line.index, pcm: spoken.pcm };
      }));
      for (const line of batch) buffers[line.index].push(Buffer.alloc(24000 * 2 * .12), line.pcm, Buffer.alloc(24000 * 2 * .18));
    }
    const scenePcm = buffers.map(value => Buffer.concat(value));
    const pcm = Buffer.concat(scenePcm);
    if (pcm.length > MAX_AUDIO_BYTES || pcm.length < 20 * SAMPLE_RATE * 2) throw SAFE_VOICE_ERROR;
    applyNarrationGain(pcm);
    return { pcm, sampleRate: SAMPLE_RATE, transcript: script, model: deps.model ?? REELS_VOICE_MODEL,
      sceneDurations: scenePcm.map(value => value.length / (SAMPLE_RATE * 2)) };
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Short, owner-requested cast audition using the same voice/model as the final dialogue. */
export async function generateCharacterVoiceSample(name: string, voice: NonNullable<VoiceDependencies['voice']>, delivery: string, model?: string, deps: Pick<VoiceDependencies, 'createConnection'> = {}): Promise<Buffer> {
  const script = `Halo, saya ${name.slice(0, 60)}. Saya akan menemani percakapan ini. Mari kita mulai dengan satu contoh yang mudah dipahami.`;
  const spoken = await requestVoice(script, `${CONVERSATIONAL_VOICE} Pembawaan karakter: ${delivery.slice(0, 500)}. Jangan menambah kata.`, { ...deps, voice, model, timeoutMs: 40_000 });
  if (!matchesSpokenScript(spokenWords(script), spoken.transcript)) throw SAFE_VOICE_ERROR;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + spoken.pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(spoken.pcm.length, 40);
  return Buffer.concat([header, spoken.pcm]);
}

async function requestVoice(script: string, instructions: string, deps: VoiceDependencies, signal?: AbortSignal): Promise<Voiceover> {
  if (signal?.aborted) throw SAFE_VOICE_ERROR;
  const model = deps.model ?? REELS_VOICE_MODEL;
  let connection: VoiceConnection;
  try {
    connection = (deps.createConnection || productionConnection)(model);
  } catch {
    throw SAFE_VOICE_ERROR;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let closeAttempted = false;
    let transcript = '';
    let audioBytes = 0;
    const audioChunks: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', fail);
      closeOnce();
    };

    const closeOnce = () => {
      if (closeAttempted) return;
      closeAttempted = true;
      try { connection.close(); } catch { /* Cleanup must not expose provider errors. */ }
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(SAFE_VOICE_ERROR);
    };

    const succeed = () => {
      if (settled) return;
      const pcm = Buffer.concat(audioChunks, audioBytes);
      if (pcm.length === 0 || pcm.length % 2 !== 0 || transcript.trim().length === 0) {
        fail();
        return;
      }
      settled = true;
      cleanup();
      resolve({ pcm, sampleRate: SAMPLE_RATE, transcript, model });
    };

    try {
      signal?.addEventListener('abort', fail, { once: true });
      connection.on('session.created', () => {
        if (settled || responseStarted) return;
        responseStarted = true;
        try {
          connection.send({
            type: 'response.create',
            response: {
              conversation: 'none',
              output_modalities: ['audio'],
              instructions,
              input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: script }] }],
              audio: { output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE }, voice: deps.voice ?? 'marin' } },
            },
          });
        } catch {
          fail();
        }
      });

      connection.on('response.output_audio.delta', (event) => {
        if (settled || !isRecord(event)) return;
        const chunk = safeBase64Buffer(event.delta);
        if (!chunk || chunk.length === 0 || audioBytes + chunk.length > MAX_AUDIO_BYTES) {
          fail();
          return;
        }
        audioBytes += chunk.length;
        audioChunks.push(chunk);
      });

      connection.on('response.output_audio_transcript.delta', (event) => {
        if (settled || !isRecord(event) || typeof event.delta !== 'string') return;
        if (transcript.length + event.delta.length > 5000) {
          fail();
          return;
        }
        transcript += event.delta;
      });

      connection.on('response.output_audio_transcript.done', (event) => {
        if (settled || !isRecord(event) || typeof event.transcript !== 'string') return;
        if (event.transcript.length > 5000) { fail(); return; }
        transcript = event.transcript;
      });

      connection.on('response.done', (event) => {
        if (settled) return;
        if (!isRecord(event) || !isRecord(event.response) || event.response.status !== 'completed') {
          fail();
          return;
        }
        succeed();
      });

      connection.on('error', fail);
      connection.socket.on('error', fail);
      connection.socket.on('close', () => {
        if (!settled) fail();
      });
      if (!signal) timer = setTimeout(fail, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    } catch {
      fail();
    }
  });
}
