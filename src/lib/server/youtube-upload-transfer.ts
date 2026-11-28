import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { YouTubeUploadMetadata } from '../youtube-upload-types';
import { youtubeChannelId } from './youtube-google';
import { assertWorkActive, type UploadWorkSignal } from './youtube-upload-deadline';

const apiOrigin = 'https://www.googleapis.com';
const uploadPath = '/upload/youtube/v3/videos';
const sessionOrigins = new Set([apiOrigin, 'https://youtube.googleapis.com']);
const privacy = z.enum(['private', 'unlisted', 'public']);
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const videoSchema = z.object({
  id: videoId,
  snippet: z.object({ channelId: youtubeChannelId }),
  status: z.object({
    privacyStatus: privacy,
    uploadStatus: z.enum(['deleted', 'failed', 'processed', 'rejected', 'uploaded']).optional(),
  }),
  processingDetails: z.object({
    processingStatus: z.enum(['failed', 'processing', 'succeeded', 'terminated']),
  }).optional(),
});
const videoList = z.object({ items: z.array(videoSchema).max(1) });
const errorBody = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string().max(120) })).max(10).optional() }) });

export type ProviderVideo = z.infer<typeof videoSchema>;
export type ProviderTransfer = { kind: 'progress'; offset: number } | { kind: 'complete'; video: ProviderVideo };
type FailureKind = 'expired' | 'permission' | 'unauthenticated' | 'retry' | 'rejected';

export class YouTubeUploadFailure extends Error {
  constructor(readonly kind: FailureKind) { super('Layanan unggah YouTube belum menyelesaikan permintaan.'); }
}

export class YouTubeRequestNotSent extends Error {
  constructor(readonly reason: unknown) { super('Permintaan unggah YouTube dihentikan sebelum dikirim.'); }
}

export function checkedYouTubeSession(raw: string) {
  try {
    if (raw.length > 4096 || /[^\x21-\x7e]/.test(raw)) throw new Error();
    const url = new URL(raw);
    if (!sessionOrigins.has(url.origin) || url.pathname !== uploadPath || url.username || url.password || url.hash) throw new Error();
    const identifiers = url.searchParams.getAll('upload_id');
    if (identifiers.length !== 1 || !/^[A-Za-z0-9_-]{1,2048}$/.test(identifiers[0])) throw new Error();
    return url.href;
  } catch {
    throw new YouTubeUploadFailure('retry');
  }
}

export function sealYouTubeSession(raw: string, context: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(checkedYouTubeSession(raw), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
}

export function openYouTubeSession(sealed: string, context: string, key: Buffer) {
  try {
    if (sealed.length > 5600) throw new Error();
    const parts = sealed.split('.');
    if (parts.length !== 3) throw new Error();
    const [iv, tag, encrypted] = parts.map(value => Buffer.from(value, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || !encrypted.length) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return checkedYouTubeSession(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  } catch {
    throw new YouTubeUploadFailure('retry');
  }
}

async function smallJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new YouTubeUploadFailure('retry');
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > 32 * 1024) {
        void reader.cancel().catch(() => {});
        throw new YouTubeUploadFailure('retry');
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new YouTubeUploadFailure('retry');
  } finally {
    reader.releaseLock();
  }
}

async function failure(response: Response, session: boolean): Promise<never> {
  if (session && (response.status === 404 || response.status === 410)) {
    void response.body?.cancel().catch(() => {});
    throw new YouTubeUploadFailure('expired');
  }
  if (response.status === 401) {
    void response.body?.cancel().catch(() => {});
    throw new YouTubeUploadFailure('unauthenticated');
  }
  if (response.status >= 500 || [408, 425, 429].includes(response.status)) {
    void response.body?.cancel().catch(() => {});
    throw new YouTubeUploadFailure('retry');
  }
  if (response.status === 403) {
    const parsed = errorBody.safeParse(await smallJson(response).catch(() => null));
    const reasons = parsed.success ? parsed.data.error.errors?.map(item => item.reason) ?? [] : [];
    if (reasons.some(reason => ['quotaExceeded', 'dailyLimitExceeded', 'userRateLimitExceeded', 'rateLimitExceeded'].includes(reason))) {
      throw new YouTubeUploadFailure('retry');
    }
    if (reasons.some(reason => ['insufficientPermissions', 'youtubeSignupRequired', 'accountDelegationForbidden'].includes(reason))) {
      throw new YouTubeUploadFailure('permission');
    }
    throw new YouTubeUploadFailure('rejected');
  }
  void response.body?.cancel().catch(() => {});
  throw new YouTubeUploadFailure('rejected');
}

function providerRequest(
  url: URL | string, accessToken: string, signal: UploadWorkSignal, init: RequestInit, fetcher: typeof fetch, assertSource?: () => void, finalBytes = false,
) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  const providerDeadline = AbortSignal.timeout(12_000);
  const deadline = finalBytes ? providerDeadline : AbortSignal.any([signal, providerDeadline]);
  try {
    assertSource?.();
    assertWorkActive(signal);
    deadline.throwIfAborted();
  } catch (error) {
    throw new YouTubeRequestNotSent(error);
  }
  return fetcher(url, { ...init, headers, cache: 'no-store', redirect: 'manual', signal: deadline })
    .catch(() => { throw new YouTubeUploadFailure('retry'); });
}

async function parseVideo(response: Response) {
  const video = videoSchema.safeParse(await smallJson(response));
  if (!video.success) throw new YouTubeUploadFailure('retry');
  return video.data;
}

export function youtubeUploadProvider(fetcher: typeof fetch = fetch) {
  async function start(
    accessToken: string, metadata: YouTubeUploadMetadata, file: { mimeType: string; size: number }, signal: UploadWorkSignal,
    assertSource?: () => void,
  ) {
    const url = new URL(uploadPath, apiOrigin);
    url.search = new URLSearchParams({
      uploadType: 'resumable', part: 'snippet,status', notifySubscribers: 'false',
      fields: 'id,snippet(channelId),status(privacyStatus,uploadStatus)',
    }).toString();
    const result = await providerRequest(url, accessToken, signal, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.mimeType,
        'X-Upload-Content-Length': String(file.size),
      },
      body: JSON.stringify({
        snippet: { title: metadata.title, description: metadata.description, categoryId: '22' },
        status: {
          privacyStatus: metadata.privacy,
          selfDeclaredMadeForKids: metadata.madeForKids,
          containsSyntheticMedia: metadata.containsSyntheticMedia,
        },
      }),
    }, fetcher, assertSource);
    if (!result.ok) return failure(result, false);
    const location = result.headers.get('location');
    void result.body?.cancel().catch(() => {});
    return checkedYouTubeSession(location ?? '');
  }

  async function transfer(
    accessToken: string, raw: string, total: number, signal: UploadWorkSignal, chunk?: { start: number; bytes: Buffer },
    assertSource?: () => void,
  ): Promise<ProviderTransfer> {
    const uri = checkedYouTubeSession(raw);
    const end = chunk && chunk.start + chunk.bytes.byteLength - 1;
    const result = await providerRequest(uri, accessToken, signal, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk?.bytes.byteLength ?? 0),
        'Content-Range': chunk ? `bytes ${chunk.start}-${end}/${total}` : `bytes */${total}`,
      },
      ...(chunk ? { body: chunk.bytes as unknown as BodyInit } : {}),
    }, fetcher, assertSource, Boolean(chunk && end !== undefined && end + 1 === total));
    if (result.status === 308) {
      const range = result.headers.get('range');
      void result.body?.cancel().catch(() => {});
      if (result.headers.has('location')) throw new YouTubeUploadFailure('retry');
      const match = range === null ? null : /^bytes=0-(\d{1,12})$/.exec(range);
      if (range !== null && !match) throw new YouTubeUploadFailure('retry');
      const offset = match ? Number(match[1]) + 1 : 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total || (end !== undefined && offset > end + 1)) {
        throw new YouTubeUploadFailure('retry');
      }
      return { kind: 'progress', offset };
    }
    if (result.status === 200 || result.status === 201) return { kind: 'complete', video: await parseVideo(result) };
    return failure(result, true);
  }

  async function video(accessToken: string, id: string, signal: UploadWorkSignal) {
    const url = new URL('/youtube/v3/videos', apiOrigin);
    url.search = new URLSearchParams({
      id: videoId.parse(id), part: 'snippet,status,processingDetails',
      fields: 'items(id,snippet(channelId),status(privacyStatus,uploadStatus),processingDetails(processingStatus))',
    }).toString();
    const result = await providerRequest(url, accessToken, signal, {}, fetcher);
    if (result.status === 404) {
      void result.body?.cancel().catch(() => {});
      return null;
    }
    if (!result.ok) return failure(result, false);
    const parsed = videoList.safeParse(await smallJson(result));
    if (!parsed.success) throw new YouTubeUploadFailure('retry');
    return parsed.data.items[0] ?? null;
  }

  async function setThumbnail(accessToken: string, id: string, image: Buffer, signal: UploadWorkSignal) {
    const url = new URL('/upload/youtube/v3/thumbnails/set', apiOrigin);
    url.search = new URLSearchParams({ videoId: videoId.parse(id), uploadType: 'media' }).toString();
    const response = await providerRequest(url, accessToken, signal, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(image),
    }, fetcher);
    if (!response.ok) return failure(response, false);
    const result = z.object({ items: z.array(z.object({})).min(1) }).safeParse(await smallJson(response));
    if (!result.success) throw new YouTubeUploadFailure('retry');
  }
  return { start, transfer, video, setThumbnail };
}

export type YouTubeUploadProvider = ReturnType<typeof youtubeUploadProvider>;
