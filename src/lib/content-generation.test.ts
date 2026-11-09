import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentGenerationError, readGenerationStream } from './content-generation';
import { streamContentGeneration, GenerationStageError } from './server/content-generation-stream';
import { ApiError } from './server/http';
const result = { draft: { id: 'draft_test', renderedMedia: { url: '/fixture.jpg' } }, engineMode: 'openai_live' };
const quiet = async (run: () => Promise<void>) => { const original = console.error; const logs: string[] = []; console.error = value => logs.push(String(value)); try { await run(); return logs; } finally { console.error = original; } };
test('stream reports real stages before result and keeps generation single-shot', async () => {
  let resolve!: () => void; const ready = new Promise<void>(r => { resolve = r; }); let calls = 0;
  const stages: string[] = [];
  const response = streamContentGeneration(async report => { calls++; report({ stage: 'script' }); await ready; report({ stage: 'saving' }); return result; });
  const pending = readGenerationStream<typeof result>(response, event => { stages.push(event.stage); if (event.stage === 'script') resolve(); });
  assert.deepEqual(await pending, result); assert.deepEqual(stages, ['script', 'saving']); assert.equal(calls, 1);
});
test('split UTF-8 and lines decode correctly without losing Indonesian copy', async () => {
  const output = { ...result, draft: { ...result.draft, title: 'Cerita — langkah kecil' } };
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'progress', stage: 'images' })+'\n'+JSON.stringify({ type: 'complete', data: output })+'\n');
  const response = new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }));
  const stages: string[] = []; assert.deepEqual(await readGenerationStream(response, p => stages.push(p.stage)), output); assert.deepEqual(stages, ['images']);
});
test('stage error is contextual, private details are absent and reference correlates logs', async () => {
  const logs = await quiet(async () => {
    const response = streamContentGeneration(async report => { report({ stage: 'images' }); throw new GenerationStageError(new Error('PRIVATE_PROVIDER_OUTPUT'), 'images'); });
    await assert.rejects(readGenerationStream(response, () => {}), (e: unknown) => e instanceof ContentGenerationError && e.stage === 'images' && !!e.requestId && e.uncertain === false && !e.message.includes('PRIVATE_PROVIDER_OUTPUT'));
  });
  assert.equal(logs.length, 1); const log = JSON.parse(logs[0]); assert.equal(log.stage, 'images'); assert.equal(log.status, 503); assert.equal(logs[0].includes('PRIVATE_PROVIDER_OUTPUT'), false);
});
test('authorization, invalid input and quota errors remain safe terminal errors', async () => {
  await quiet(async () => { for (const status of [400, 401, 403, 429]) {
    const response = streamContentGeneration(async () => { throw new ApiError(status, 'Safe user message', 'request_failed'); });
    await assert.rejects(readGenerationStream(response, () => {}), (e: unknown) => e instanceof ContentGenerationError && e.stage === 'validation' && !e.uncertain && e.message === 'Safe user message');
  } });
});
test('truncated/malformed streams never report success or silently restart a generation', async () => {
  for (const body of ['', '{bad json}\n', JSON.stringify({type:'progress',stage:'images'})+'\n', JSON.stringify({type:'complete',data:{draft:{id:'missing_media'}}})+'\n']) {
    await assert.rejects(readGenerationStream(new Response(body), () => {}), (e: unknown) => e instanceof ContentGenerationError && e.uncertain);
  }
});
test('uncertain storage result prompts reconciliation and never exposes raw storage details', async () => {
  await quiet(async () => {
    const response = streamContentGeneration(async () => { throw new GenerationStageError(new Error('PRIVATE_STORAGE_OUTPUT'), 'saving'); });
    await assert.rejects(readGenerationStream(response, () => {}), (e: unknown) => e instanceof ContentGenerationError && e.uncertain && e.stage === 'saving' && !e.message.includes('PRIVATE_STORAGE_OUTPUT'));
  });
});
