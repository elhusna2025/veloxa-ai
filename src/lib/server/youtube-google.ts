import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './http';
import { YOUTUBE_READONLY_SCOPE, type YouTubeConfig } from './youtube-config';
import { youtubeToken } from './youtube-crypto';

const pageSize = 50;
const pageLimit = 5;
const maxResponseBytes = 128 * 1024;
export const YOUTUBE_CHANNEL_LIMIT = pageSize * pageLimit;
export const youtubeChannelId = z.string().length(24).regex(/^UC[A-Za-z0-9_-]{22}$/);
export const youtubeChannel = z.object({ channelId: youtubeChannelId, title: z.string().min(1).max(200), handle: z.string().max(256) });
export function publicYouTubeChannel({ channelId, title, handle }: z.infer<typeof youtubeChannel>) {
  return { channelId, title, handle, url: `https://www.youtube.com/channel/${channelId}` };
}

const tokenResponse = z.object({
  access_token: youtubeToken,
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().int().positive().max(86_400),
  scope: z.string().min(1).max(4096),
  refresh_token: z.unknown().optional(),
});
const channelPage = z.object({
  items: z.array(z.object({ id: youtubeChannelId, snippet: z.object({ title: youtubeChannel.shape.title, customUrl: z.string().max(256).optional() }) })).max(pageSize),
  nextPageToken: z.string().min(1).max(2048).regex(/^[\x21-\x7e]+$/).optional(),
});
const providerError = () => new ApiError(502, 'YouTube belum dapat memverifikasi koneksi. Mulai ulang dan berikan izin baca kanal.', 'youtube_oauth_failed');

export function buildYouTubeAuthorizeUrl(config: YouTubeConfig, state: string, verifier: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: YOUTUBE_READONLY_SCOPE, access_type: 'offline', prompt: 'select_account consent', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

async function providerJson(url: URL | string, init: RequestInit, fetcher: typeof fetch, signal: AbortSignal): Promise<unknown> {
  try {
    signal.throwIfAborted();
    const response = await fetcher(url, { ...init, cache: 'no-store', redirect: 'error', signal });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxResponseBytes) {
      void response.body?.cancel().catch(() => {});
      throw new Error();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        void reader.cancel().catch(() => {});
        throw new Error();
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw providerError(); }
}

export async function exchangeYouTubeGrant(config: YouTubeConfig, code: string, verifier: string, {
  fetcher = fetch, now = Date.now, signal = AbortSignal.timeout(12_000),
}: { fetcher?: typeof fetch; now?: () => number; signal?: AbortSignal } = {}) {
  const form = new URLSearchParams({
    client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier,
    redirect_uri: config.redirectUri, grant_type: 'authorization_code',
  });
  const token = tokenResponse.safeParse(await providerJson('https://oauth2.googleapis.com/token', { method: 'POST', body: form }, fetcher, signal));
  if (!token.success) throw providerError();
  const grantedScopes = new Set(token.data.scope.trim().split(/\s+/));
  if (grantedScopes.size !== 1 || !grantedScopes.has(YOUTUBE_READONLY_SCOPE)) throw providerError();
  const refresh = youtubeToken.safeParse(token.data.refresh_token);
  if (!refresh.success) throw new ApiError(409, 'Izin YouTube tidak menyertakan akses berkelanjutan. Hubungkan kembali akun dan setujui izin.', 'reconnect_required');
  const accessExpiresAt = now() + token.data.expires_in * 1000;
  const accessToken = token.data.access_token;
  const channels = new Map<string, ReturnType<typeof publicYouTubeChannel>>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let index = 0; index < pageLimit; index++) {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.search = new URLSearchParams({
      part: 'id,snippet', mine: 'true', maxResults: String(pageSize), fields: 'nextPageToken,items(id,snippet(title,customUrl))',
      ...(cursor ? { pageToken: cursor } : {}),
    }).toString();
    const page = channelPage.safeParse(await providerJson(url, { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher, signal));
    if (!page.success) throw providerError();
    for (const { id, snippet } of page.data.items) {
      if (channels.has(id)) throw providerError();
      const handle = snippet.customUrl && /^@[\p{L}\p{M}\p{N}._·-]+$/u.test(snippet.customUrl) ? snippet.customUrl : '';
      channels.set(id, publicYouTubeChannel({ channelId: id, title: snippet.title, handle }));
    }
    cursor = page.data.nextPageToken;
    if (!cursor) break;
    if (cursors.has(cursor) || index === pageLimit - 1) throw providerError();
    cursors.add(cursor);
  }
  if (!channels.size || !Number.isSafeInteger(accessExpiresAt) || accessExpiresAt <= now()) throw providerError();
  return { tokens: { accessToken, refreshToken: refresh.data }, accessExpiresAt, channels: [...channels.values()] };
}
