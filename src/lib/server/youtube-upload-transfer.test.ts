import assert from 'node:assert/strict';
import test from 'node:test';
import { youtubeUploadProvider } from './youtube-upload-transfer';

const session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture';
const video = { id: 'fixture1234', snippet: { channelId: 'UC' + 'A'.repeat(22) }, status: { privacyStatus: 'private', uploadStatus: 'uploaded' } };

test('a dispatched final PUT retains its receipt body after the worker actually aborts', async () => {
  const worker = new AbortController(); let requestAborted = false;
  const provider = youtubeUploadProvider((async (_, options) => {
    const requestSignal = options!.signal!;
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
    requestSignal.addEventListener('abort', () => { requestAborted = true; body.error(requestSignal.reason); }, { once: true });
    queueMicrotask(() => {
      worker.abort(new DOMException('worker budget elapsed', 'AbortError'));
      if (!requestAborted) { body.enqueue(new TextEncoder().encode(JSON.stringify(video))); body.close(); }
    });
    return new Response(stream, { status: 201, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  const result = await provider.transfer('fixture-access', session, 5, worker.signal, { start: 0, bytes: Buffer.from('video') });
  assert.equal(worker.signal.aborted, true); assert.equal(requestAborted, false);
  assert.equal(result.kind, 'complete'); if (result.kind === 'complete') assert.equal(result.video.id, video.id);
});
