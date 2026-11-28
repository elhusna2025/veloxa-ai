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

export async function synthesizeAchird(text: string, signal?: AbortSignal, speakingRate = 1) {
  const client = await auth.getClient();
  const response = await client.request<{ audioContent: string }>({
    method: 'POST', url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
    timeout: 30_000, signal, retry: false,
    data: { input: { text }, voice: { languageCode: 'id-ID', name: achirdVoice },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate } },
  });
  return readIndonesianSpeech(Buffer.from(response.data.audioContent, 'base64'));
}
