import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from './http';
import { YOUTUBE_READONLY_SCOPE, type YouTubeConfig } from './youtube-config';
import { youtubeToken } from './youtube-crypto';
import { youtubeChannelId } from './youtube-google';
import { assertWorkActive, type UploadWorkSignal } from './youtube-upload-deadline';
import { youtubeUploadNeedsPermission, YouTubeUploadTokenRejected } from './youtube-upload-records';

const scopes = [YOUTUBE_READONLY_SCOPE, 'https://www.googleapis.com/auth/youtube.upload'];
const pageSize = 50;
const pageLimit = 5;
const maxResponseBytes = 128 * 1024;
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const scopeSchema = z.string().min(1).max(4096);
const tokenResponse = z.object({
  access_token: youtubeToken,
  refresh_token: youtubeToken.optional(),
  token_type: z.string().max(16).refine(value => /^bearer$/i.test(value)),
  expires_in: z.number().int().positive().max(86_400),
  scope: scopeSchema.optional(),
});
const channelPage = z.object({
  items: z.array(z.object({ id: youtubeChannelId })).max(pageSize),
  nextPageToken: z.string().min(1).max(1024).regex(/^[\x21-\x7e]+$/).optional(),
});
const providerUnavailable = () => new ApiError(502, 'YouTube belum dapat memverifikasi izin unggah. Coba lagi.', 'youtube_upload_provider_unavailable');
const boundedSignal = (signal?: UploadWorkSignal) => {
  const deadline = AbortSignal.timeout(12_000);
  return signal ? Object.assign(AbortSignal.any([deadline, signal]), {
    assertActive: () => assertWorkActive(signal),
  }) : deadline;
};
type ProviderOptions = { fetcher?: typeof fetch; signal?: UploadWorkSignal };
type TokenOptions = ProviderOptions & { now?: () => number };

export function buildYouTubeUploadAuthorizeUrl(config: YouTubeConfig, state: string, verifier: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  return url.href;
}

async function googleJson(url: URL | string, init: RequestInit, fetcher: typeof fetch, signal: UploadWorkSignal, readBadRequest = false) {
  try {
    assertWorkActive(signal);
    const response = await fetcher(url, { ...init, cache: 'no-store', redirect: 'error', signal });
    if (!response.ok && !(readBadRequest && response.status === 400)) {
      void response.body?.cancel().catch(() => {});
      return { status: response.status, ok: false, data: null as unknown };
    }
    if (!response.body || Number(response.headers.get('content-length')) > maxResponseBytes) {
      void response.body?.cancel().catch(() => {});
      throw new Error();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        void reader.cancel().catch(() => {});
        throw new Error();
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    return { status: response.status, ok: response.ok, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch { throw providerUnavailable(); }
}

export async function assertSingleYouTubeUploadChannel(
  accessToken: string, expectedChannelId: string, { fetcher = fetch, signal }: ProviderOptions = {},
): Promise<void> {
  if (!youtubeToken.safeParse(accessToken).success || !youtubeChannelId.safeParse(expectedChannelId).success) throw youtubeUploadNeedsPermission();
  const deadline = boundedSignal(signal);
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let matched = false;
  for (let index = 0; index < pageLimit; index++) {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.search = new URLSearchParams({
      part: 'id', mine: 'true', maxResults: String(pageSize), fields: 'nextPageToken,items(id)',
      ...(cursor ? { pageToken: cursor } : {}),
    }).toString();
    const response = await googleJson(url, { headers: { Authorization: `Bearer ${accessToken}` } }, fetcher, deadline);
    if (response.status === 401) throw new YouTubeUploadTokenRejected();
    const page = channelPage.safeParse(response.data);
    if (!response.ok || !page.success) throw providerUnavailable();
    for (const { id } of page.data.items) {
      if (matched || id !== expectedChannelId) throw youtubeUploadNeedsPermission();
      matched = true;
    }
    cursor = page.data.nextPageToken;
    if (!cursor) {
      if (!matched) throw youtubeUploadNeedsPermission();
      return;
    }
    if (cursors.has(cursor)) throw providerUnavailable();
    cursors.add(cursor);
  }
  throw providerUnavailable();
}

async function requestTokens(config: YouTubeConfig, parameters: Record<string, string>, previousRefreshToken: string | undefined, {
  fetcher = fetch, now = Date.now, signal,
}: TokenOptions) {
  const form = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters });
  const result = await googleJson(tokenEndpoint, { method: 'POST', body: form }, fetcher, boundedSignal(signal), true);
  if (!result.ok) {
    const failure = z.object({ error: z.string().max(128) }).safeParse(result.data);
    if (result.status === 401 || (result.status === 400 && failure.success && ['invalid_grant', 'invalid_token', 'invalid_scope'].includes(failure.data.error))) {
      throw new YouTubeUploadTokenRejected();
    }
    throw providerUnavailable();
  }
  const token = tokenResponse.safeParse(result.data);
  if (!token.success) throw youtubeUploadNeedsPermission();
  if (token.data.scope !== undefined || previousRefreshToken === undefined) {
    const returned = new Set(token.data.scope?.trim().split(/\s+/));
    if (returned.size !== scopes.length || scopes.some(scope => !returned.has(scope))) throw youtubeUploadNeedsPermission();
  }
  const refreshToken = token.data.refresh_token ?? previousRefreshToken;
  if (!refreshToken) throw youtubeUploadNeedsPermission();
  const issuedAt = now();
  const accessExpiresAt = issuedAt + token.data.expires_in * 1000;
  if (!Number.isSafeInteger(accessExpiresAt) || accessExpiresAt <= issuedAt) throw providerUnavailable();
  return { tokens: { accessToken: token.data.access_token, refreshToken }, accessExpiresAt };
}

export async function exchangeYouTubeUploadGrant(config: YouTubeConfig, code: string, verifier: string, channelId: string, options: TokenOptions = {}) {
  const signal = boundedSignal(options.signal);
  const grant = await requestTokens(config, {
    code, code_verifier: verifier, redirect_uri: config.redirectUri, grant_type: 'authorization_code',
  }, undefined, { ...options, signal });
  await assertSingleYouTubeUploadChannel(grant.tokens.accessToken, channelId, { ...options, signal });
  if (grant.accessExpiresAt <= (options.now ?? Date.now)()) throw youtubeUploadNeedsPermission();
  return grant;
}

export function refreshYouTubeUploadGrant(config: YouTubeConfig, refreshToken: string, options: TokenOptions = {}) {
  return requestTokens(config, { refresh_token: refreshToken, grant_type: 'refresh_token' }, refreshToken, options);
}
