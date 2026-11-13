import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { ApiError } from './http';
type Flow = 'meta' | 'meta_ads' | 'instagram';
const cookieName = (flow: Flow) => `__Host-veloxa_${flow}_oauth`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const options = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 };
function nonce(url: URL) {
  const value = url.searchParams.get('state') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ApiError(400, 'Sesi koneksi tidak valid. Mulai kembali dari Veloxa.', 'oauth_browser_mismatch');
  return value;
}
export function attachOAuthBrowserState(response: NextResponse, authorizeUrl: string, flow: Flow) {
  response.cookies.set(cookieName(flow), digest(nonce(new URL(authorizeUrl))), options);
  return response;
}
export function verifyOAuthBrowserState(request: Request, flow: Flow) {
  const expected = digest(nonce(new URL(request.url)));
  const values = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(cookieName(flow) + '=')).map(value => value.slice(cookieName(flow).length + 1));
  if (values.length !== 1 || !/^[a-f0-9]{64}$/.test(values[0]) || !timingSafeEqual(Buffer.from(values[0], 'hex'), Buffer.from(expected, 'hex'))) throw new ApiError(400, 'Sesi koneksi tidak cocok dengan browser ini. Mulai kembali dari Veloxa.', 'oauth_browser_mismatch');
}
export function clearOAuthBrowserState(response: NextResponse, flow: Flow) {
  response.cookies.set(cookieName(flow), '', { ...options, maxAge: 0 });
  return response;
}
