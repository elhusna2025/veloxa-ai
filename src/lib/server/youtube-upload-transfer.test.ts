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

test('sends a selected JPEG to the existing video thumbnail endpoint', async () => {
  const image = Buffer.from([255, 216, 255, 217]);
  const provider = youtubeUploadProvider(async (address, options) => {
    const url = new URL(String(address));
    assert.equal(url.pathname, '/upload/youtube/v3/thumbnails/set');
    assert.equal(url.searchParams.get('videoId'), video.id);
    assert.equal(new Headers(options?.headers).get('Content-Type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(options?.body as Uint8Array), image);
    return Response.json({ items: [{ default: { width: 1280 } }] });
  });
  await provider.setThumbnail('test', video.id, image, new AbortController().signal);
});
