import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
export const achirdVoice = 'id-ID-Chirp3-HD-Achird';

/** Cloud TTS LINEAR16 includes a RIFF header. Only audio samples belong on the scene timeline. */
export function readIndonesianSpeech(wav: Buffer) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Format rekaman narator tidak sesuai.');
  let validFormat = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > wav.length) break;
    if (name === 'fmt ' && length >= 16) {
      validFormat = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 &&
        wav.readUInt32LE(start + 4) === 24000 && wav.readUInt16LE(start + 14) === 16;
    }
    if (name === 'data' && validFormat && length > 0 && length % 2 === 0) return wav.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  throw new Error('Rekaman Indonesia 24 kHz mono belum lengkap.');
}

async function synthesize(input: { text: string } | { ssml: string }, signal?: AbortSignal, speakingRate = 1) {
  const client = await auth.getClient();
  const response = await client.request<{ audioContent: string }>({
    method: 'POST', url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
    timeout: 30_000, signal, retry: false,
    data: { input, voice: { languageCode: 'id-ID', name: achirdVoice },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate } },
  });
  return readIndonesianSpeech(Buffer.from(response.data.audioContent, 'base64'));
}

export function synthesizeAchird(text: string, signal?: AbortSignal, speakingRate = 1) {
  return synthesize({ text }, signal, speakingRate);
}

/** Locate the deliberately long SSML breaks, trimming only digital quiet inside each one. */
export function splitAchirdChapter(pcm: Buffer, count: number) {
  const takes: Buffer[] = [];
  const rate = 24000;
  const step = rate / 100; // 10 ms of mono PCM16
  const samples = pcm.length / 2;
  let lastCut = 0;
  let quietFrom = 0;
  let heardSpeech = false;
  for (let i = 0; i < samples; i += step) {
    const end = Math.min(i + step, samples);
    let peak = 0;
    for (let n = i; n < end; n++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(n * 2)));
    if (peak < 48) continue;
    if (heardSpeech && i - quietFrom >= rate * 1.3) {
      takes.push(pcm.subarray(lastCut * 2, (quietFrom + rate * .25) * 2));
      lastCut = i - rate * .15;
    }
    heardSpeech = true;
    quietFrom = end;
  }
  if (!heardSpeech || takes.length !== count - 1) return;
  takes.push(pcm.subarray(lastCut * 2));
  return { pcm: Buffer.concat(takes), sceneDurations: takes.map(take => take.length / (2 * rate)) };
}

export async function synthesizeAchirdChapter(lines: string[], signal?: AbortSignal, speakingRate = 1) {
  const escape = (line: string) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ssml = '<speak>' + lines.map(escape).join('<break time="2s"/>') + '</speak>';
  if (Buffer.byteLength(ssml) > 5000) return;
  return splitAchirdChapter(await synthesize({ ssml }, signal, speakingRate), lines.length);
}
