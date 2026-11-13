import { ApiError } from './http';

export const INSTAGRAM_LOGIN_SCOPES = ['instagram_basic', 'instagram_content_publish'] as const;
export function instagramLoginConfig() {
  const appId = process.env.META_APP_ID || '';
  const appCredential = process.env.META_APP_SECRET || '';
  const configId = process.env.INSTAGRAM_LOGIN_CONFIG_ID || '';
  const redirectUri = process.env.INSTAGRAM_LOGIN_REDIRECT_URI || '';
  let url: URL;
  try { url = new URL(redirectUri); } catch { throw unavailable(); }
  if (process.env.INSTAGRAM_LOGIN_ENABLED !== 'true' || !/^\d+$/.test(appId) || !/^\d+$/.test(configId) || !appCredential || url.protocol !== 'https:' || url.pathname !== '/api/veloxa/instagram/callback' || url.search || url.hash || url.username || url.password) throw unavailable();
  return { appId, appCredential, configId, redirectUri, origin: url.origin };
}
function unavailable() { return new ApiError(503, 'Koneksi Instagram langsung sedang disiapkan. Silakan coba kembali nanti.', 'instagram_not_configured'); }
export function isInstagramLoginConfigured() {
  try { instagramLoginConfig(); return true; } catch { return false; }
}
