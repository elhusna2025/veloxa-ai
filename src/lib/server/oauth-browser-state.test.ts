import test from 'node:test';
import assert from 'node:assert/strict';
import { NextResponse } from 'next/server';
import { attachOAuthBrowserState, verifyOAuthBrowserState, clearOAuthBrowserState } from './oauth-browser-state';
const a = Buffer.alloc(32, 1).toString('base64url');
const b = Buffer.alloc(32, 2).toString('base64url');
const authorize = (state: string) => 'https://www.facebook.com/dialog/oauth?' + new URLSearchParams({ state });
const callback = (state: string, cookie?: string) => new Request('http://127.0.0.1:8080/api/veloxa/instagram/callback/?' + new URLSearchParams({ state }), { headers: cookie ? { cookie } : {} });
test('OAuth state uses a host-only secure HttpOnly Lax cookie and supports proxy callbacks', () => {
  for (const flow of ['instagram','meta'] as const) {
    const response = attachOAuthBrowserState(NextResponse.json({ ok: true }), authorize(a), flow);
    const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /__Host-veloxa_/);assert.match(cookie, /HttpOnly/);assert.match(cookie, /Secure/);assert.match(cookie, /SameSite=lax/i);assert.match(cookie, /Path=\//);assert.match(cookie, /Max-Age=600/);assert.doesNotMatch(cookie, /Domain=/i);
    assert.equal(cookie.includes(a), false);
    verifyOAuthBrowserState(callback(a, cookie.split(';')[0]), flow);
  }
});
test('a state from another browser, another flow, or duplicate cookies cannot authorize a callback', () => {
  const res = attachOAuthBrowserState(NextResponse.json({}), authorize(a), 'instagram');
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  assert.throws(() => verifyOAuthBrowserState(callback(a), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback(b, cookie), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback(a, cookie), 'meta'));
  assert.throws(() => verifyOAuthBrowserState(callback(a, cookie + '; ' + cookie), 'instagram'));
  assert.throws(() => verifyOAuthBrowserState(callback('invalid', cookie), 'instagram'));
});
test('callback responses clear only the current flow cookie using identical security attributes', () => {
  const response = clearOAuthBrowserState(NextResponse.redirect('https://veloxa.example.test/'), 'instagram');
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /__Host-veloxa_instagram_oauth=/);assert.match(cookie, /Max-Age=0/);assert.match(cookie, /Secure/);assert.match(cookie, /HttpOnly/);assert.doesNotMatch(cookie, /__Host-veloxa_meta_oauth/);
});
