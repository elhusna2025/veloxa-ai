import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { ApiError } from './http';
import { REELS_SPEC, reelsWordCount } from '../reels-spec';
import { DEFAULT_CONTENT_MODELS } from '../admin-settings';

export const REELS_VOICE_MODEL = DEFAULT_CONTENT_MODELS.voiceModel;
export const REELS_VOICE_DISCLOSURE = 'Voiceover menggunakan suara AI.';

const MAX_AUDIO_BYTES = REELS_SPEC.maxSourceAudioSeconds * 48_000;
const SAFE_VOICE_ERROR = new ApiError(503, 'Voiceover Reels belum dapat dibuat. Silakan coba lagi.', 'reels_voice_unavailable');
const INVALID_SCRIPT_ERROR = new ApiError(400, `Skrip Reels harus berisi ${REELS_SPEC.minVoiceWords}–${REELS_SPEC.maxVoiceWords} kata dan maksimal ${REELS_SPEC.maxScriptChars.toLocaleString('id-ID')} karakter.`, 'invalid_reels_script');

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
): Promise<{ pcm: Buffer; sampleRate: 24000; transcript: string; model: string }> {
  if (!isValidScript(script)) throw INVALID_SCRIPT_ERROR;

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

    const closeOnce = () => {
      if (closeAttempted) return;
      closeAttempted = true;
      try { connection.close(); } catch { /* Cleanup must not expose provider errors. */ }
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      closeOnce();
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
      if (timer) clearTimeout(timer);
      closeOnce();
      resolve({ pcm, sampleRate: 24000, transcript, model });
    };

    try {
      connection.on('session.created', () => {
        if (settled || responseStarted) return;
        responseStarted = true;
        try {
          connection.send({
            type: 'response.create',
            response: {
              conversation: 'none',
              output_modalities: ['audio'],
              instructions: `Ucapkan hanya naskah pengguna persis dalam Bahasa Indonesia. Gunakan suara percakapan yang lembut, halus, hangat, dan dekat, seperti sedang mengobrol santai langsung dengan satu orang. Ekspresif secara halus: rasa ingin tahu yang tulus pada pertanyaan pembuka, penekanan kecil pada gagasan penting, lalu penutup yang penuh dukungan. Biarkan tinggi-rendah nada mengalir dengan variasi kecil yang tidak teratur; hindari pola naik-turun berulang, pelafalan setiap suku kata yang terlalu rapi, atau penekanan seragam. Gabungkan kata menjadi frasa percakapan yang utuh. Gunakan jeda singkat alami di pergantian pikiran, jangan berhenti di setiap kata. Tempo santai dan luwes; sesuaikan panjang naskah untuk durasi ${REELS_SPEC.minDurationSeconds}–${REELS_SPEC.maxDurationSeconds} detik tanpa memanjangkan jeda atau menambah kata. Senyum tipis dalam suara, bukan gaya penyiar, presentasi, atau iklan. Tetap jelas tanpa berbisik, mendesah, suara napas buatan, berteriak, atau tambahan kata dan efek suara.`,
              input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: script }] }],
              audio: { output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' } },
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
      timer = setTimeout(fail, deps.timeoutMs ?? 90_000);
    } catch {
      fail();
    }
  });
}
