import { createHash } from 'node:crypto';
import { ApiError } from './http';

export const YOUTUBE_CALLBACK_PATH = '/api/veloxa/youtube/callback';
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

export type YouTubeEnv = Readonly<Record<string, string | undefined>>;

export function youtubeRedirect(env: YouTubeEnv = process.env) {
  const redirectUri = env.YOUTUBE_REDIRECT_URI || '';
  if (redirectUri.length > 2048 || !redirectUri.endsWith(YOUTUBE_CALLBACK_PATH)) return null;
  const authority = redirectUri.slice(0, -YOUTUBE_CALLBACK_PATH.length);
  if (!/^https:\/\/[^/\\?#@\s\x00-\x1f\x7f]+$/.test(authority)) return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== 'https:' || url.pathname !== YOUTUBE_CALLBACK_PATH || url.search || url.hash || url.username || url.password) return null;
    return { redirectUri, origin: url.origin };
  } catch { return null; }
}

export function youtubeNotConfigured() {
  return new ApiError(503, 'Koneksi YouTube belum dikonfigurasi.', 'youtube_not_configured');
}

export function youtubeConfig(env: YouTubeEnv = process.env) {
  const redirect = youtubeRedirect(env);
  const clientId = env.YOUTUBE_CLIENT_ID || '';
  const clientSecret = env.YOUTUBE_CLIENT_SECRET || '';
  const encodedKey = env.YOUTUBE_TOKEN_ENCRYPTION_KEY || '';
  const credential = /^[\x21-\x7e]{1,512}$/;
  if (env.YOUTUBE_OAUTH_ENABLED !== 'true' || !redirect || !credential.test(clientId) || !credential.test(clientSecret) || encodedKey.length !== 44) return null;
  const encryptionKey = Buffer.from(encodedKey, 'base64');
  if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== encodedKey) return null;
  const configBinding = createHash('sha256').update(JSON.stringify([clientId, clientSecret, redirect.redirectUri, YOUTUBE_READONLY_SCOPE, encodedKey])).digest('hex');
  return { ...redirect, clientId, clientSecret, encryptionKey, configBinding };
}

export type YouTubeConfig = NonNullable<ReturnType<typeof youtubeConfig>>;

export function isYouTubeConfigured(env: YouTubeEnv = process.env) {
  return youtubeConfig(env) !== null;
}
