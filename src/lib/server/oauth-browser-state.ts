import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { ApiError } from './http';
type Flow = 'meta' | 'meta_ads' | 'instagram' | 'youtube';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function cookieName(flow: Flow, state?: string) {
  const name = `__Host-veloxa_${flow}_oauth`;
  if (flow !== 'youtube') return name;
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new ApiError(400, 'Sesi koneksi tidak valid. Mulai kembali dari Veloxa.', 'oauth_browser_mismatch');
  // An older callback may finish after another business starts authorization.
  // Its response must only expire the cookie belonging to that exact attempt.
  return `${name}_${digest(state)}`;
}
const options = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 };
function nonce(url: URL) {
  const value = url.searchParams.get('state') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ApiError(400, 'Sesi koneksi tidak valid. Mulai kembali dari Veloxa.', 'oauth_browser_mismatch');
  return value;
}
export function attachOAuthBrowserState(response: NextResponse, authorizeUrl: string, flow: Flow, browserSecret?: string) {
  const state = nonce(new URL(authorizeUrl));
  if (flow === 'youtube' && (!browserSecret || !/^[A-Za-z0-9_-]{43}$/.test(browserSecret))) throw new ApiError(400, 'Sesi koneksi tidak valid. Mulai kembali dari Veloxa.', 'oauth_browser_mismatch');
  response.cookies.set(cookieName(flow, state), flow === 'youtube' ? browserSecret! : digest(state), options);
  return response;
}
export function verifyOAuthBrowserState(request: Request, flow: Flow, browserSecretDigest?: string) {
  const state = nonce(new URL(request.url));
  const expected = flow === 'youtube' ? browserSecretDigest : digest(state);
  const name = cookieName(flow, state);
  const values = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(name + '=')).map(value => value.slice(name.length + 1));
  const validValue = values.length === 1 && (flow === 'youtube' ? /^[A-Za-z0-9_-]{43}$/ : /^[a-f0-9]{64}$/).test(values[0]);
  const actual = validValue ? (flow === 'youtube' ? digest(values[0]) : values[0]) : '';
  if (!validValue || !expected || !/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) throw new ApiError(400, 'Sesi koneksi tidak cocok dengan browser ini. Mulai kembali dari Veloxa.', 'oauth_browser_mismatch');
}
export function clearOAuthBrowserState(response: NextResponse, flow: Flow, state?: string) {
  response.cookies.set(cookieName(flow, state), '', { ...options, maxAge: 0 });
  return response;
}
