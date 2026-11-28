import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { generateYouTubeNarration, generateReelsVoiceover, generateDialogueVoiceover, generateCharacterVoiceSample, REELS_VOICE_MODEL } from './reels-voice';
import { REELS_SPEC } from '../reels-spec';

const script = 'Pernah penasaran kenapa langkah kecil bisa membuat hari terasa lebih ringan? Mulai saja dengan memilih satu kebiasaan sederhana yang cocok untukmu. Tak perlu langsung sempurna, beri dirimu waktu untuk mencoba dan menemukan ritme yang nyaman. Pelan-pelan, perubahan baik bisa tumbuh. Semoga tips ini membantu, ya.';

class MockConnection extends EventEmitter {
  socket = new EventEmitter();
  sent: Record<string, unknown>[] = [];
  closeCount = 0;

  send(event: Record<string, unknown>) { this.sent.push(event); }
  close() { this.closeCount += 1; }
}

function mock() {
  const connection = new MockConnection();
  return { connection, createConnection: () => connection as never };
}

function makeAudioEvent(bytes: Buffer) {
  return { delta: bytes.toString('base64') };
}

function emitCompletion(connection: MockConnection, audio = Buffer.from([1, 0, 2, 0]), transcript = 'Halo, ini narasi yang hangat.') {
  connection.emit('session.created', {});
  connection.emit('response.output_audio.delta', makeAudioEvent(audio));
  connection.emit('response.output_audio_transcript.delta', { delta: transcript });
  connection.emit('response.done', { response: { status: 'completed' } });
}

const sceneLines = [
  'Mau latihan TKA? Coba buat peta konsep dahulu supaya belajar lebih terarah.',
  'Tulis satu topik di tengah kertas, lalu tarik tiga cabang untuk ide utama.',
  'Isi setiap cabang dengan satu contoh dan tandai bagian yang masih membuatmu ragu.',
  'Pilih satu cabang lalu mulai latihan dari situ. Coba gunakan cara ini besok juga.',
];

test('dialogue keeps saved speaker voices through role changes and preserves scene timing', async () => {
  const requests: { voice: string; text: string; instructions: string }[] = [];
  const createConnection = () => {
    const connection = new MockConnection();
    queueMicrotask(() => {
      connection.emit('session.created', {});
      const response = connection.sent[0].response as { audio: { output: { voice: string } }; input: { content: { text: string }[] }[]; instructions: string };
      const text = response.input[0].content[0].text;
      requests.push({ voice: response.audio.output.voice, text, instructions: response.instructions });
      connection.emit('response.output_audio.delta', makeAudioEvent(Buffer.alloc(6 * 48000)));
      connection.emit('response.output_audio_transcript.done', { transcript: text });
      connection.emit('response.done', { response: { status: 'completed' } });
    });
    return connection as never;
  };
  const voices = ['cedar', 'coral', 'cedar', 'marin'] as const;
  const result = await generateDialogueVoiceover(sceneLines.map((text, index) => ({ lines: [{ text, voice: voices[index], delivery: index === 2 ? 'Rani menjawab dengan tenang.' : 'Bicara dengan alami.' }] })), { createConnection });
  assert.deepEqual(requests.map(request => request.voice), voices);
  assert.deepEqual(requests.map(request => request.text), sceneLines);
  assert.ok(requests[2].instructions.includes('Rani menjawab dengan tenang'));
  assert.equal(result.sceneDurations?.length, 4);
  assert.equal(result.sceneDurations?.reduce((sum, value) => sum + value, 0), result.pcm.length / 48000);
  const text = 'Pahami satu contoh sederhana sebelum menentukan langkah berikutnya untuk usaha yang lebih terarah dan jujur.';
  const seven = await generateDialogueVoiceover(Array.from({ length: 7 }, () => ({ lines: [{ text, voice: 'marin' as const, delivery: 'Hangat.' }] })), { createConnection });
  assert.equal(seven.sceneDurations?.length, 7);
  assert.equal(seven.sceneDurations!.reduce((sum, seconds) => sum + Math.round(seconds * 24000) * 2, 0), seven.pcm.length);
});

test('cast audition is a playable mono WAV using the same saved voice and exact spoken text', async () => {
  const connection = new MockConnection();
  const pcm = Buffer.alloc(4 * 48000);
  queueMicrotask(() => {
    connection.emit('session.created', {});
    const response = connection.sent[0].response as { audio: { output: { voice: string } }; input: { content: { text: string }[] }[] };
    assert.equal(response.audio.output.voice, 'sage');
    emitCompletion(connection, pcm, response.input[0].content[0].text);
  });
  const wav = await generateCharacterVoiceSample('Rani', 'sage', 'Hangat', undefined, { createConnection: () => connection as never });
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(40), pcm.length); assert.deepEqual(wav.subarray(44), pcm);
});

function mockScenes(transcriptFor: (line: string, attempt: number) => string, lines = sceneLines, audioForScene?: (index: number) => Buffer) {
  const requests: { line: string; instructions: string }[] = [];
  const connections: MockConnection[] = [];
  const attempts = new Map<string, number>();
  const createConnection = () => {
    const connection = new MockConnection();
    connections.push(connection);
    queueMicrotask(() => {
      connection.emit('session.created', {});
      const response = connection.sent[0].response as { instructions: string; input: { content: { text: string }[] }[] };
      const line = response.input[0].content[0].text;
      const index = lines.indexOf(line);
      assert.notEqual(index, -1);
      const attempt = (attempts.get(line) ?? 0) + 1;
      attempts.set(line, attempt);
      requests.push({ line, instructions: response.instructions });
      connection.emit('response.output_audio.delta', makeAudioEvent(audioForScene?.(index) ?? Buffer.alloc((index + 2) * 48_000, index + 1)));
      connection.emit('response.output_audio_transcript.done', { transcript: transcriptFor(line, attempt) });
      connection.emit('response.done', { response: { status: 'completed' } });
    });
    return connection as never;
  };
  return { requests, connections, createConnection };
}

test('memvalidasi panjang dan jumlah kata sebelum membuka koneksi', async () => {
  let started = false;
  await assert.rejects(
    generateReelsVoiceover('Kata terlalu sedikit.', { createConnection: () => { started = true; return new MockConnection() as never; } }),
    (error: unknown) => (error as { status?: number; code?: string }).status === 400 && (error as { code?: string }).code === 'invalid_reels_script',
  );
  assert.equal(started, false);
  await assert.rejects(generateReelsVoiceover('kata '.repeat(REELS_SPEC.maxVoiceWords + 1), { createConnection: () => { started = true; return new MockConnection() as never; } }), { code: 'invalid_reels_script' });
  await assert.rejects(generateReelsVoiceover(`${'x'.repeat(REELS_SPEC.maxScriptChars + 1)} ${'kata '.repeat(39)}`, { createConnection: () => { started = true; return new MockConnection() as never; } }), { code: 'invalid_reels_script' });
  assert.equal(started, false);
});

test('accepts 100 and 130 words with unchanged voice/model and rejects cumulative audio above 90s', async () => {
  for (const words of [100, REELS_SPEC.maxVoiceWords]) {
    const { connection, createConnection } = mock();
    const result = generateReelsVoiceover('kata '.repeat(words).trim(), { createConnection });
    emitCompletion(connection);
    assert.equal((await result).model, REELS_VOICE_MODEL);
    assert.equal(connection.closeCount, 1);
  }
  const maximum = mock();
  const maximumResult = generateReelsVoiceover(script, { createConnection: maximum.createConnection });
  emitCompletion(maximum.connection, Buffer.alloc(REELS_SPEC.maxSourceAudioSeconds * 48_000));
  assert.equal((await maximumResult).pcm.length, REELS_SPEC.maxSourceAudioSeconds * 48_000);
  const { connection, createConnection } = mock();
  const result = generateReelsVoiceover(script, { createConnection });
  connection.emit('session.created', {});
  const half = Buffer.alloc(REELS_SPEC.maxSourceAudioSeconds * 24_000);
  connection.emit('response.output_audio.delta', makeAudioEvent(half));
  connection.emit('response.output_audio.delta', makeAudioEvent(half));
  connection.emit('response.output_audio.delta', makeAudioEvent(Buffer.alloc(2)));
  await assert.rejects(result, { code: 'reels_voice_unavailable' });
  assert.equal(connection.closeCount, 1);
});

test('mengirim naskah dengan konfigurasi suara naratif dan menggabungkan audio serta transkrip', async () => {
  const { connection, createConnection } = mock();
  const resultPromise = generateReelsVoiceover(script, { createConnection });
  connection.emit('session.created', {});
  connection.emit('session.created', {});
  assert.equal(connection.sent.length, 1);
  assert.equal(connection.sent[0].type, 'response.create');
  const response = connection.sent[0].response as Record<string, unknown>;
  assert.equal(response.conversation, 'none');
  assert.deepEqual(response.output_modalities, ['audio']);
  const audio = response.audio as { output: { format: { type: string; rate: number }; voice: string } };
  assert.deepEqual(audio.output, { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' });
  assert.match(String(response.instructions), /hangat|ramah/);
  assert.match(String(response.instructions), /intonasi|jeda/);
  assert.match(String(response.instructions), /20–60 detik/);
  assert.doesNotMatch(String(response.instructions), /25–30/);
  assert.deepEqual(response.input, [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: script }] }]);

  connection.emit('response.output_audio.delta', makeAudioEvent(Buffer.from([1, 0])));
  connection.emit('response.output_audio.delta', makeAudioEvent(Buffer.from([2, 0, 3, 0])));
  connection.emit('response.output_audio_transcript.delta', { delta: 'Narasi ' });
  connection.emit('response.output_audio_transcript.delta', { delta: 'hangat.' });
  connection.emit('response.done', { response: { status: 'completed' } });
  const result = await resultPromise;
  assert.deepEqual(result.pcm, Buffer.from([1, 0, 2, 0, 3, 0]));
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.transcript, 'Narasi hangat.');
  assert.equal(result.model, REELS_VOICE_MODEL);
  assert.equal(connection.closeCount, 1);
  connection.socket.emit('close');
  assert.equal(connection.closeCount, 1);
});

test('membuka koneksi Realtime dengan model pilihan dan mencatatnya pada hasil', async () => {
  const connection = new MockConnection();
  const model = 'gpt-realtime-2.1';
  const result = generateReelsVoiceover(script, {
    model,
    createConnection: selected => {
      assert.equal(selected, model);
      return connection as never;
    },
  });
  emitCompletion(connection);
  assert.equal((await result).model, model);
});

test('membaca setiap adegan, menerima ejaan akronim, serta menjaga batas PCM untuk transisi', async () => {
  const { requests, connections, createConnection } = mockScenes(line => line.replace('TKA', 'Te Ka A').toUpperCase().replace(/[.,?]/g, ''));
  const result = await generateReelsVoiceover(sceneLines.join(' '), { createConnection, sceneLines });

  assert.deepEqual(requests.map(request => request.line), sceneLines);
  assert.match(requests[0].instructions, /intonasi tanya/);
  assert.match(requests[1].instructions, /kata kunci/);
  assert.match(requests[2].instructions, /contoh atau detail/);
  assert.match(requests[3].instructions, /penuh dukungan/);
  assert.ok(connections.every(connection => connection.closeCount === 1));
  assert.deepEqual(result.sceneDurations, [3.5, 4.5, 5.5, 6.5]);
  assert.equal(result.pcm.length, 20 * 48_000);
  let offset = 0;
  for (const [index, duration] of result.sceneDurations!.entries()) {
    const leadBytes = Math.round(0.28 * 48_000);
    const voiceBytes = (index + 2) * 48_000;
    const end = offset + duration * 48_000;
    assert.ok(result.pcm.subarray(offset, offset + leadBytes).every(byte => byte === 0));
    const gained = Math.round((index + 1) * 257 * 10 ** (6 / 20));
    assert.equal(result.pcm.readInt16LE(offset + leadBytes), gained);
    assert.equal(result.pcm.readInt16LE(offset + leadBytes + voiceBytes - 2), gained);
    assert.ok(result.pcm.subarray(offset + leadBytes + voiceBytes, end).every(byte => byte === 0));
    offset = end;
  }
});

test('menerapkan gain yang seragam sambil menjaga puncak narasi sekitar -2 dBFS', async () => {
  const samples = [-32_000, 16_000, -8_000, 2_000];
  const { createConnection } = mockScenes(line => line, sceneLines, index => {
    const pcm = Buffer.alloc(2);
    pcm.writeInt16LE(samples[index]);
    return pcm;
  });
  const result = await generateReelsVoiceover(sceneLines.join(' '), { createConnection, sceneLines });
  const peak = Math.floor(32767 * 10 ** (-2 / 20));
  let offset = 0;
  for (const [index, duration] of result.sceneDurations!.entries()) {
    assert.equal(result.pcm.readInt16LE(offset + Math.round(0.28 * 48_000)), Math.round(samples[index] * peak / 32_000));
    offset += Math.round(duration * 48_000);
  }
});

test('mengulang satu kali jika voiceover menambah pengantar dan menolak pengulangan yang masih berubah', async () => {
  const first = mockScenes((line, attempt) => line === sceneLines[0] && attempt === 1 ? `Halo semua. ${line}` : line);
  const result = await generateReelsVoiceover(sceneLines.join(' '), { createConnection: first.createConnection, sceneLines });
  assert.equal(first.requests.length, 5);
  assert.equal(result.transcript, sceneLines.join(' '));

  const second = mockScenes(line => line === sceneLines[0] ? `Halo semua. ${line}` : line);
  await assert.rejects(generateReelsVoiceover(sceneLines.join(' '), { createConnection: second.createConnection, sceneLines }), { code: 'reels_voice_unavailable' });
  assert.equal(second.requests.filter(request => request.line === sceneLines[0]).length, 2);
  assert.equal(second.requests.length, 3);
  assert.ok(second.connections.every(connection => connection.closeCount === 1));
});

test('menerima pengucapan angka Indonesia dengan nilai dan satuan yang sama', async () => {
  const lines = [
    'Untuk memulai, gunakan 3 ide pokok dan catat peningkatan latihan sebesar 12,5%.',
    'Siapkan Rp50.000 untuk bahan dan catat pengeluarannya agar mudah diperiksa.',
    'Tulis angka dua ratus empat belas di kartu bagian depan dan seribu di belakang.',
    'Periksa penurunan sebesar −4,05% dengan teliti sebelum merangkum hasil latihan ini.',
  ];
  const transcripts = [
    'Untuk memulai, gunakan tiga ide pokok dan catat peningkatan latihan sebesar dua belas koma lima persen.',
    'Siapkan lima puluh ribu rupiah untuk bahan dan catat pengeluarannya agar mudah diperiksa.',
    'Tulis angka 214 di kartu bagian depan dan 1.000 di belakang.',
    'Periksa penurunan sebesar minus empat koma nol lima persen dengan teliti sebelum merangkum hasil latihan ini.',
  ];
  const correct = mockScenes(line => transcripts[lines.indexOf(line)], lines);
  const result = await generateReelsVoiceover(lines.join(' '), { createConnection: correct.createConnection, sceneLines: lines });
  assert.equal(correct.requests.length, lines.length);
  assert.equal(result.transcript, transcripts.join(' '));

  const changed = [
    [0, 'dua belas koma lima persen', 'tiga belas koma lima persen'],
    [0, 'lima persen', 'lima'],
    [1, 'lima puluh ribu rupiah', 'enam puluh ribu rupiah'],
    [1, 'lima puluh ribu rupiah', 'lima puluh ribu'],
    [3, 'minus empat', 'empat'],
  ] as const;
  for (const [index, phrase, replacement] of changed) {
    const incorrect = mockScenes(line => line === lines[index] ? transcripts[index].replace(phrase, replacement) : transcripts[lines.indexOf(line)], lines);
    await assert.rejects(generateReelsVoiceover(lines.join(' '), { createConnection: incorrect.createConnection, sceneLines: lines }), { code: 'reels_voice_unavailable' });
    assert.equal(incorrect.requests.filter(request => request.line === lines[index]).length, 2);
  }
});

test('menolak skrip adegan yang berbeda dan membatalkan semua koneksi pada batas waktu', async () => {
  const invalid = mockScenes(line => line);
  await assert.rejects(generateReelsVoiceover(sceneLines.join(' '), {
    createConnection: invalid.createConnection, sceneLines: [...sceneLines.slice(0, 3), 'Penutup berbeda.'],
  }), { code: 'invalid_reels_script' });
  assert.equal(invalid.connections.length, 0);

  const connections: MockConnection[] = [];
  await assert.rejects(generateReelsVoiceover(sceneLines.join(' '), {
    sceneLines, timeoutMs: 10,
    createConnection: () => {
      const connection = new MockConnection();
      connections.push(connection);
      return connection as never;
    },
  }), { code: 'reels_voice_unavailable' });
  assert.equal(connections.length, 2);
  assert.ok(connections.every(connection => connection.closeCount === 1));
});

test('menolak audio malformed, kosong, terlalu besar, dan respons gagal dengan error aman', async () => {
  for (const scenario of ['malformed', 'empty', 'oversized', 'failed'] as const) {
    const { connection, createConnection } = mock();
    const result = generateReelsVoiceover(script, { createConnection });
    connection.emit('session.created', {});
    if (scenario === 'malformed') connection.emit('response.output_audio.delta', { delta: '***=' });
    if (scenario === 'empty') {
      connection.emit('response.output_audio_transcript.delta', { delta: 'Ada transkrip.' });
      connection.emit('response.done', { response: { status: 'completed' } });
    }
    if (scenario === 'oversized') connection.emit('response.output_audio.delta', makeAudioEvent(Buffer.alloc(REELS_SPEC.maxSourceAudioSeconds * 48_000 + 2)));
    if (scenario === 'failed') connection.emit('error', new Error('secret-token provider response'));
    await assert.rejects(result, (error: unknown) => {
      assert.equal((error as { status?: number }).status, 503);
      assert.equal((error as { code?: string }).code, 'reels_voice_unavailable');
      assert.equal((error as Error).message.includes('secret-token'), false);
      return true;
    });
    assert.equal(connection.closeCount, 1);
  }
});

test('menolak PCM ganjil, timeout, dan koneksi yang ditutup sebelum respons selesai', async () => {
  {
    const { connection, createConnection } = mock();
    const result = generateReelsVoiceover(script, { createConnection });
    connection.emit('session.created', {});
    connection.emit('response.output_audio.delta', makeAudioEvent(Buffer.from([1, 2, 3])));
    connection.emit('response.output_audio_transcript.delta', { delta: 'Transkrip ada.' });
    connection.emit('response.done', { response: { status: 'completed' } });
    await assert.rejects(result, { code: 'reels_voice_unavailable' });
  }
  {
    const { connection, createConnection } = mock();
    const result = generateReelsVoiceover(script, { createConnection, timeoutMs: 10 });
    await assert.rejects(result, { code: 'reels_voice_unavailable' });
    assert.equal(connection.closeCount, 1);
  }
  {
    const { connection, createConnection } = mock();
    const result = generateReelsVoiceover(script, { createConnection });
    connection.socket.emit('close');
    await assert.rejects(result, { code: 'reels_voice_unavailable' });
    assert.equal(connection.closeCount, 1);
  }
});

test('YouTube keeps one confirmed narrator across scene turns and seeds each subsequent chapter once', async () => {
  const { connection, createConnection } = mock();
  const recording = generateYouTubeNarration(sceneLines, { voice: 'ash', createConnection, referencePcm: Buffer.alloc(48000) });
  connection.emit('session.created', {});
  assert.equal(connection.sent[0].type, 'session.update');
  const session = connection.sent[0].session as { instructions: string };
  assert.ok(sceneLines.every(line => session.instructions.includes(line)));
  connection.emit('session.updated', { session: { audio: { output: { voice: 'ash' } } } });
  for (const line of sceneLines) {
    const item = connection.sent.at(-2)?.item as { content: { text: string }[] };
    assert.equal(item.content[0].text, line);
    connection.emit('response.output_audio.delta', makeAudioEvent(Buffer.alloc(48000)));
    connection.emit('response.output_audio_transcript.done', { transcript: line });
    connection.emit('response.done', { response: { status: 'completed' } });
  }
  assert.deepEqual((await recording).sceneDurations, [1, 1, 1, 1]);
  assert.equal(connection.closeCount, 1);
  assert.equal(connection.sent.filter(e => JSON.stringify(e).includes('input_audio')).length, 1);
  const mismatch = mock();
  const rejected = generateYouTubeNarration(sceneLines, { voice: 'ash', createConnection: mismatch.createConnection });
  mismatch.connection.emit('session.created', {});
  mismatch.connection.emit('session.updated', { session: { audio: { output: { voice: 'marin' } } } });
  await assert.rejects(rejected);
  assert.equal(mismatch.connection.sent.length, 1);
});
