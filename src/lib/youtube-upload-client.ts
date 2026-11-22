import { signedVeloxaFetch } from './veloxa-api-client';
import {
  YOUTUBE_CHUNK_BYTES,
  YOUTUBE_MAX_BYTES,
  type YouTubeUploadFile,
  type YouTubeUploadKind,
  type YouTubeUploadList,
  type YouTubeUploadMetadata,
  type YouTubeUploadOperation,
  type YouTubeUploadPermission,
} from './youtube-upload-types';

const PREFIX = '/api/veloxa/youtube';
const MIME_TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' } as const;
export const YOUTUBE_FILE_ACCEPT = '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm';
export type YouTubeUploadScope = { workspaceId: string; businessId: string };
export type ReviewedUpload = {
  channelId: string;
  connectionRevision: string;
  kind: YouTubeUploadKind;
  file: YouTubeUploadFile;
  metadata: YouTubeUploadMetadata;
};

export class YouTubeRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function retryableYouTubeError(error: unknown) {
  return !(error instanceof YouTubeRequestError) || [408, 425, 429].includes(error.status) || error.status >= 500;
}

export function youtubeUploadEndpoint(path: string) {
  const [pathname, query] = path.split('?', 2);
  return PREFIX + pathname.replace(/\/?$/, '/') + (query ? '?' + query : '');
}

async function request<T>(path: string, init: RequestInit = {}, timeout = 20_000): Promise<T> {
  const response = await signedVeloxaFetch(youtubeUploadEndpoint(path), {
    ...init,
    redirect: 'error',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new YouTubeRequestError(
      typeof error?.error === 'string' ? error.error : 'Layanan YouTube Veloxa belum dapat merespons. Coba periksa kembali.',
      response.status,
    );
  }
  return response.json();
}

function json(body: object, signal?: AbortSignal): RequestInit {
  return { method: 'POST', body: JSON.stringify(body), signal };
}

export function youtubeUploadApi(scope: YouTubeUploadScope) {
  const query = new URLSearchParams(scope).toString();
  const operationPath = (id: string) => '/uploads/' + encodeURIComponent(id);
  return {
    permission: (signal?: AbortSignal) => request<YouTubeUploadPermission>('/upload-permission?' + query, { signal }),
    startPermission: (values: { channelId: string; connectionRevision: string; startRevision: number }, signal?: AbortSignal) =>
      request<{ ok: true; url: string }>('/upload-permission/start', json({ ...scope, ...values }, signal)),
    confirmPermission: (pending: NonNullable<YouTubeUploadPermission['pending']>, signal?: AbortSignal) =>
      request<{ ok: true }>('/upload-permission', json({
        ...scope,
        authorizationId: pending.authorizationId,
        channelId: pending.channelId,
        connectionRevision: pending.connectionRevision,
      }, signal)),
    list: (signal?: AbortSignal) => request<YouTubeUploadList>('/uploads?' + query, { signal }),
    get: async (id: string, signal?: AbortSignal) => (await request<{ ok: true; operation: YouTubeUploadOperation }>(operationPath(id) + '?' + query, { signal })).operation,
    create: async (operationId: string, upload: ReviewedUpload, signal?: AbortSignal) =>
      (await request<{ ok: true; operation: YouTubeUploadOperation }>('/uploads', json({ ...scope, ...upload, operationId, confirmed: true }, signal))).operation,
    chunk: async (id: string, index: number, data: Blob, signal?: AbortSignal) =>
      (await request<{ ok: true; operation: YouTubeUploadOperation }>(operationPath(id) + '/chunk?' + query + '&index=' + index, {
        method: 'PUT', body: data, headers: { 'Content-Type': 'application/octet-stream' }, signal,
      }, 45_000)).operation,
    action: async (id: string, action: 'process' | 'check' | 'cancel', signal?: AbortSignal) =>
      (await request<{ ok: true; operation: YouTubeUploadOperation }>(operationPath(id) + '/action', json({ ...scope, action }, signal), 65_000)).operation,
  };
}

export function validateYouTubeFile(file: File, maxBytes = YOUTUBE_MAX_BYTES) {
  const suffix = file.name.split('.').pop()?.toLowerCase();
  const mimeType = suffix && Object.hasOwn(MIME_TYPES, suffix) ? MIME_TYPES[suffix as keyof typeof MIME_TYPES] : undefined;
  if (!mimeType) throw new Error('Pilih file video berformat MP4, MOV, atau WebM.');
  if (!file.size) throw new Error('File video kosong. Pilih file yang lain.');
  if (file.size > maxBytes) throw new Error('Ukuran file melebihi batas unggahan Veloxa.');
  return mimeType;
}

export async function hashYouTubeFile(file: File, signal: AbortSignal): Promise<YouTubeUploadFile> {
  const mimeType = validateYouTubeFile(file);
  const chunkHashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += YOUTUBE_CHUNK_BYTES) {
    signal.throwIfAborted();
    const bytes = await file.slice(offset, offset + YOUTUBE_CHUNK_BYTES).arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    chunkHashes.push(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  signal.throwIfAborted();
  return { name: file.name, size: file.size, mimeType, chunkHashes };
}

export function sameYouTubeFile(expected: YouTubeUploadOperation['file'], actual: YouTubeUploadFile) {
  return expected.size === actual.size && expected.chunkHashes.length === actual.chunkHashes.length
    && expected.chunkHashes.every((hash, index) => hash === actual.chunkHashes[index]);
}

export function sameReviewedYouTubeFile(expected: YouTubeUploadOperation['file'], actual: YouTubeUploadFile) {
  return expected.name === actual.name && expected.mimeType === actual.mimeType && sameYouTubeFile(expected, actual);
}

export function youtubeUploadReturnKey(workspaceId: string) {
  return 'veloxa:youtube-upload:return:' + workspaceId;
}

export function consumeYouTubeUploadReturnIntent(workspaceId: string): string | null {
  try {
    const key = youtubeUploadReturnKey(workspaceId);
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const intent = JSON.parse(raw || 'null');
    const now = Date.now();
    if (intent?.workspaceId === workspaceId && typeof intent.businessId === 'string' && typeof intent.createdAt === 'number'
      && Number.isFinite(intent.createdAt) && intent.createdAt <= now && now - intent.createdAt <= 15 * 60_000) return intent.businessId;
  } catch { /* A missing or unreadable intent cannot restore a business. */ }
  return null;
}

export function verifiedGoogleAuthorization(raw: string) {
  const url = new URL(raw);
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.hash) {
    throw new Error('Alamat pemberian izin Google belum dapat diverifikasi.');
  }
  return url.href;
}

function operationKey(scope: YouTubeUploadScope) {
  return 'veloxa:youtube-upload:operation:' + encodeURIComponent(scope.workspaceId) + ':' + encodeURIComponent(scope.businessId);
}

export function pendingYouTubeOperation(scope: YouTubeUploadScope) {
  const id = localStorage.getItem(operationKey(scope));
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function reserveYouTubeOperation(scope: YouTubeUploadScope) {
  const previous = pendingYouTubeOperation(scope);
  const id = previous || crypto.randomUUID();
  localStorage.setItem(operationKey(scope), id);
  if (pendingYouTubeOperation(scope) !== id) throw new Error('Referensi unggahan belum tersimpan.');
  return { id, reused: previous !== null };
}

export function clearYouTubeOperation(scope: YouTubeUploadScope, id: string) {
  if (pendingYouTubeOperation(scope) === id) localStorage.removeItem(operationKey(scope));
}
