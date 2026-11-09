import { randomUUID } from 'node:crypto';
import { ApiError, errorResponse } from './http';
import { GENERATION_LABELS, type GenerationProgress, type GenerationStage } from '../content-generation';
export class GenerationStageError extends ApiError {
  constructor(error: unknown, public stage: GenerationStage) {
    super(error instanceof ApiError ? error.status : 503, error instanceof ApiError ? error.message : `${GENERATION_LABELS[stage]} belum berhasil. Silakan coba lagi.`, error instanceof ApiError ? error.code : 'generation_stage_failed');
  }
}
export function streamContentGeneration<T>(generate: (progress: (event: GenerationProgress) => void) => Promise<T>) {
  const requestId = randomUUID(); const encoder = new TextEncoder(); let closed = false; let heartbeat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: object) => { if (!closed) { try { controller.enqueue(encoder.encode(JSON.stringify({ ...event, requestId }) + '\n')); } catch { closed = true; clearInterval(heartbeat); } } };
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 10_000);
      void (async () => {
        try { send({ type: 'complete', data: await generate(progress => send({ type: 'progress', ...progress })) }); }
        catch (error) {
          const stage = error instanceof GenerationStageError ? error.stage : 'validation';
          const response = errorResponse(error); const safe = await response.json();
          // Whitelisted diagnostics only: no provider output, prompts, credentials, or URLs.
          console.error(JSON.stringify({ event: 'content_generation_failed', requestId, stage, code: safe.code, status: response.status }));
          send({ type: 'error', stage, error: safe.error, code: safe.code, uncertain: stage === 'saving' });
        } finally { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } }
      })();
    },
    cancel() { closed = true; clearInterval(heartbeat); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff' } });
}
