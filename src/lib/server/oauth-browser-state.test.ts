import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { attachOAuthBrowserState, verifyOAuthBrowserState, clearOAuthBrowserState } from './oauth-browser-state';
const a = Buffer.alloc(32, 1).toString('base64url');
const b = Buffer.alloc(32, 2).toString('base64url');
const secretA = Buffer.alloc(32, 3).toString('base64url');
const secretB = Buffer.alloc(32, 4).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const authorize = (state: string) => 'https://www.facebook.com/dialog/oauth?' + new URLSearchParams({ state });
const callback = (state: string, cookie?: string) => new Request('http://127.0.0.1:8080/api/veloxa/instagram/callback/?' + new URLSearchParams({ state }), { headers: cookie ? { cookie } : {} });
test('OAuth state uses a host-only secure HttpOnly Lax cookie and supports proxy callbacks', () => {
  for (const flow of ['instagram','meta','meta_ads','youtube'] as const) {
    const response = attachOAuthBrowserState(NextResponse.json({ ok: true }), authorize(a), flow, flow === 'youtube' ? secretA : undefined);
    const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /__Host-veloxa_/);assert.match(cookie, /HttpOnly/);assert.match(cookie, /Secure/);assert.match(cookie, /SameSite=lax/i);assert.match(cookie, /Path=\//);assert.match(cookie, /Max-Age=600/);assert.doesNotMatch(cookie, /Domain=/i);
    assert.equal(cookie.includes(a), false);
    verifyOAuthBrowserState(callback(a, cookie.split(';')[0]), flow, flow === 'youtube' ? digest(secretA) : undefined);
  }
});
test('a state from another browser, another flow, or duplicate cookies cannot authorize a callback', () => {
  const res = attachOAuthBrowserState(NextResponse.json({}), authorize(a), 'instagram');
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  assert.throws(() => verifyOAuthBrowserState(callback(a), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback(b, cookie), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback(a, cookie), 'meta'));
  const adsCookie = attachOAuthBrowserState(NextResponse.json({}), authorize(a), 'meta_ads').headers.get('set-cookie')!.split(';')[0];
  assert.throws(() => verifyOAuthBrowserState(callback(a, adsCookie), 'meta'));
  verifyOAuthBrowserState(callback(a, adsCookie), 'meta_ads');
  const youtubeCookie = attachOAuthBrowserState(NextResponse.json({}), authorize(a), 'youtube', secretA).headers.get('set-cookie')!.split(';')[0];
  assert.equal(youtubeCookie, `__Host-veloxa_youtube_oauth_${digest(a)}=${secretA}`);
  verifyOAuthBrowserState(callback(a, youtubeCookie), 'youtube', digest(secretA));
  assert.throws(() => verifyOAuthBrowserState(callback(a, youtubeCookie), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback(a, adsCookie), 'youtube'));
  assert.throws(() => verifyOAuthBrowserState(callback(a, cookie + '; ' + cookie), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback('invalid', cookie), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback(a, youtubeCookie + '; ' + youtubeCookie), 'youtube', digest(secretA)));
  assert.throws(() => verifyOAuthBrowserState(callback(a, `__Host-veloxa_youtube_oauth_${digest(a)}=${digest(a)}`), 'youtube', digest(secretA)));
  assert.throws(() => verifyOAuthBrowserState(callback(a, `__Host-veloxa_youtube_oauth_${digest(a)}=${a}`), 'youtube', digest(secretA)));
});
test('callback responses clear only the current flow cookie using identical security attributes', () => {
  for (const flow of ['instagram', 'meta', 'meta_ads'] as const) {
    const response = clearOAuthBrowserState(NextResponse.redirect('https://veloxa.example.test/'), flow);
    const cookie = response.headers.get('set-cookie')!;
    assert.equal(cookie.split('=')[0], `__Host-veloxa_${flow}_oauth`);
    assert.match(cookie, /Max-Age=0/);assert.match(cookie, /Secure/);assert.match(cookie, /HttpOnly/);
  }
});
test('YouTube attempts coexist and an older response expires only its own independent browser proof', () => {
  const cookieA = attachOAuthBrowserState(NextResponse.json({}), authorize(a), 'youtube', secretA).headers.get('set-cookie')!.split(';')[0];
  const cookieB = attachOAuthBrowserState(NextResponse.json({}), authorize(b), 'youtube', secretB).headers.get('set-cookie')!.split(';')[0];
  const jar = new Map([cookieA, cookieB].map(value => value.split('=') as [string, string]));
  const header = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  verifyOAuthBrowserState(callback(a, header()), 'youtube', digest(secretA));
  verifyOAuthBrowserState(callback(b, header()), 'youtube', digest(secretB));
  const response = clearOAuthBrowserState(NextResponse.json({}), 'youtube', a);
  const clear = response.headers.get('set-cookie')!;
  assert.equal(clear.split('=')[0], cookieA.split('=')[0]);
  assert.match(clear, /Max-Age=0/);
  assert.match(clear, /HttpOnly/); assert.match(clear, /Secure/); assert.match(clear, /SameSite=lax/i);
  assert.doesNotMatch(clear, new RegExp(digest(b)));
  jar.delete(clear.split('=')[0]);
  assert.throws(() => verifyOAuthBrowserState(callback(a, header()), 'youtube', digest(secretA)));
  verifyOAuthBrowserState(callback(b, header()), 'youtube', digest(secretB));
  assert.throws(() => clearOAuthBrowserState(NextResponse.json({}), 'youtube'));
});
