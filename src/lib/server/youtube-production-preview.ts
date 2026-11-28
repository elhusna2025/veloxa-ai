import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { adminDb } from './firebase';
import { ApiError, errorResponse, noStoreJson } from './http';
import { productionMediaAccess } from './youtube-production-jobs';

const cookieName = (id: string) => `veloxa_youtube_${id.replace(/-/g, '')}`;
const path = (id: string) => `/api/veloxa/youtube/productions/${id}/media/`;
function sign(value: string) {
  const key = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new ApiError(503, 'Pratinjau video belum dikonfigurasi.');
  return createHmac('sha256', key).update('youtube-production-viewer-v1\0').update(value).digest('base64url');
}
export function productionRange(header: string | null, size: number) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Ukuran media tidak valid.');
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (![start, end].every(Number.isSafeInteger) || start < 0 || start >= size || end < start) return null;
  return { start, end, partial: true };
}
export async function youtubeProductionPreview(request: Request, rawId: string) {
  try {
    const id = z.uuid().parse(rawId);
    if (request.method === 'POST') {
      const { ref, job } = await productionMediaAccess.owned(request, id);
      const payload = Buffer.from(JSON.stringify({ key: ref.id, owner: job.ownerUid, expires: Date.now() + 30 * 60_000 })).toString('base64url');
      const response = noStoreJson({ ready: true });
      response.headers.append('Set-Cookie', `${cookieName(id)}=${payload}.${sign(payload)}; Path=${path(id)}; HttpOnly; SameSite=Strict; Max-Age=1800${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`);
      return response;
    }
    const token = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName(id) + '='))?.slice(cookieName(id).length + 1);
    if (!token || token.length > 1200) throw new ApiError(401, 'Buka ulang pratinjau melalui Studio.');
    const [payload, signature] = token.split('.');
    const expected = sign(payload);
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ApiError(401, 'Pratinjau tidak lagi berlaku.');
    const claims = z.object({ key: z.string().regex(/^[a-f0-9]{64}_[a-f0-9-]{36}$/), owner: z.string().min(1).max(512), expires: z.number().int() }).parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!claims.key.endsWith('_' + id) || claims.expires < Date.now() || claims.expires > Date.now() + 31 * 60_000) throw new ApiError(401, 'Pratinjau telah berakhir.');
    const ref = adminDb().collection(productionMediaAccess.collection).doc(claims.key);
    const job = (await ref.get()).data();
    const ws = job ? (await adminDb().collection('workspaces').doc(job.workspaceId).get()).data() : undefined;
    if (!job || job.ownerUid !== claims.owner || ws?.ownerUid !== claims.owner) throw new ApiError(403, 'Pratinjau tidak tersedia.');
    const name = new URL(request.url).searchParams.get('name') ?? 'final.mp4';
    const thumbnailId = /^thumb-([a-f0-9-]{36})\.jpg$/.exec(name)?.[1];
    const isThumbnail = thumbnailId && (job.thumbnails?.options?.includes(thumbnailId) || job.thumbnails?.selected === thumbnailId);
    if (!isThumbnail && !/^(final\.mp4|actor_[1-5]\.(jpg|wav)|\d{1,5}-preview\.jpg)$/.test(name) || name === 'final.mp4' && job.state !== 'ready') throw new ApiError(404, 'Media belum tersedia.');
    const actorMedia = /^(actor_[1-5])\.(jpg|wav)$/.exec(name);
    const storageName = actorMedia ? productionMediaAccess.characterMediaName(job, actorMedia[1], actorMedia[2] as 'jpg' | 'wav') : name;
    const file = name === 'final.mp4' && job.sourceGeneration
      ? productionMediaAccess.object(ref, name).bucket.file(`private-youtube-productions/${ref.id}/${name}`, { generation: job.sourceGeneration })
      : productionMediaAccess.object(ref, storageName);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size), range = productionRange(request.headers.get('range'), size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'private, no-store' } });
    const headers = new Headers({ 'Content-Type': name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.wav') ? 'audio/wav' : 'image/jpeg',
      'Content-Length': String(range.end - range.start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    if (range.partial) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    if (new URL(request.url).searchParams.get('download') === '1') headers.set('Content-Disposition', isThumbnail ? 'attachment; filename="veloxa-thumbnail.jpg"' : 'attachment; filename="veloxa-video.mp4"');
    if (request.method === 'HEAD') return new Response(null, { status: range.partial ? 206 : 200, headers });
    const stream = file.createReadStream({ start: range.start, end: range.end });
    const stop = () => stream.destroy(); request.signal.addEventListener('abort', stop, { once: true });
    stream.once('close', () => request.signal.removeEventListener('abort', stop));
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range.partial ? 206 : 200, headers });
  } catch (error) { return errorResponse(error); }
}
