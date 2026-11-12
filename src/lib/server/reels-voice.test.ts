import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { generateReelsVoiceover, REELS_VOICE_MODEL } from './reels-voice';
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
