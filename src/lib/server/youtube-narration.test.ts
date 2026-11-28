import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { youtubeNarratorDelivery } from '../youtube-production';
import { paceYouTubeSpeech, youtubeSpeechBounds } from './youtube-speech-pacing';
import { readIndonesianSpeech } from './youtube-indonesian-voice';
import { sceneSubtitles } from './youtube-production-renderer';

test('narrator direction includes the voiceover brief but excludes other sections', () => {
  assert.equal(youtubeNarratorDelivery({ delivery: 'Jeda alami.', topic: 'Cerita kota\n- Voice-over: Suara pria dalam dan tegas.\n- Musik: instrumental.' }), 'Jeda alami. Suara pria dalam dan tegas.');
  assert.equal(youtubeNarratorDelivery({ delivery: 'Santai.', topic: 'Cerita kota' }), 'Santai.');
});

test('shot changes reserve breathing space, keep existing pauses and retain all recorded samples', () => {
  const speech = Buffer.alloc(48000);
  for (let i = 0; i < speech.length; i += 2) speech.writeInt16LE(1200, i);
  const withPause = Buffer.concat([Buffer.alloc(24000), speech, Buffer.alloc(38400)]);
  const result = paceYouTubeSpeech(Buffer.concat([speech, withPause]), [1, 2.3], ['Ke mana?', 'Ke pasar.']);
  assert.deepEqual(result.sceneDurations, [1.96, 2.3]);
  assert.deepEqual(result.pcm.subarray(.32 * 48000, 1.32 * 48000), speech);
  assert.deepEqual(result.pcm.subarray(1.96 * 48000), withPause);
  const captions = sceneSubtitles('Ke mana?', 49, 1280, 720, youtubeSpeechBounds(result.pcm.subarray(0, 1.96 * 48000)));
  assert.match(captions, /Dialogue: 0,0:00:00.32,0:00:01.32/);
  assert.throws(() => paceYouTubeSpeech(speech, [.8], ['Halo.']));
  assert.throws(() => paceYouTubeSpeech(Buffer.alloc(48000), [1], ['Halo.']));
});

test('Achird accepts only complete mono PCM at the scene sample rate', () => {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(40, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(4, 40);
  const samples = Buffer.from([0, 4, 0, 5]);
  const wav = Buffer.concat([header, samples]);
  assert.deepEqual(readIndonesianSpeech(wav), samples);
  assert.throws(() => readIndonesianSpeech(wav.subarray(0, 46)));
  wav.writeUInt32LE(48000, 24);
  assert.throws(() => readIndonesianSpeech(wav));
});
