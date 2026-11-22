import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './http';
import { YOUTUBE_READONLY_SCOPE, youtubeConfig } from './youtube-config';
import { exchangeYouTubeGrant } from './youtube-google';

const config = youtubeConfig({
  YOUTUBE_OAUTH_ENABLED: 'true', YOUTUBE_CLIENT_ID: 'fixture-client', YOUTUBE_CLIENT_SECRET: 'fixture-client-secret',
  YOUTUBE_OAUTH_ALLOWED_WORKSPACE_IDS: 'workspace-test',
  YOUTUBE_REDIRECT_URI: 'https://veloxa.example.test/api/veloxa/youtube/callback',
  YOUTUBE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
})!;
const access = 'fixture-access';
const refresh = 'fixture-refresh';
const verifier = 'fixture-verifier';
const code = 'fixture-code';
const token = { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: YOUTUBE_READONLY_SCOPE };
const id = (letter: string) => 'UC' + letter.repeat(22);
const providerError = (error: unknown) => error instanceof ApiError && error.code === 'youtube_oauth_failed' && ![access, refresh, code, config.clientSecret].some(value => error.message.includes(value));

test('Google menerima penukar kode PKCE yang cocok dan discovery mine melalui endpoint tetap', async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    assert.ok(init?.signal);
    assert.equal(url.href.includes(access) || url.href.includes(code), false);
    if (urls.length === 1) {
      assert.equal(url.href, 'https://oauth2.googleapis.com/token');
      assert.equal(init.method, 'POST');
      assert.ok(init.body instanceof URLSearchParams);
      assert.deepEqual(Object.fromEntries(init.body), {
        client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier,
        redirect_uri: config.redirectUri, grant_type: 'authorization_code',
      });
      return Response.json({ ...token, scope: `  ${YOUTUBE_READONLY_SCOPE}\t${YOUTUBE_READONLY_SCOPE}  ` });
    }
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/channels');
    assert.equal(url.searchParams.get('mine'), 'true');
    assert.equal(url.searchParams.get('part'), 'id,snippet');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${access}`);
    if (urls.length === 2) return Response.json({ items: [{ id: id('A'), snippet: { title: 'Kanal A', customUrl: '@contoh' } }], nextPageToken: 'test-cursor', next: 'https://ignored.example.test/' });
    assert.equal(url.searchParams.get('pageToken'), 'test-cursor');
    return Response.json({ items: [{ id: id('B'), snippet: { title: 'Kanal B', customUrl: 'legacy-slug' } }] });
  };
  const grant = await exchangeYouTubeGrant(config, code, verifier, { fetcher, now: () => 10_000 });
  assert.equal(urls.length, 3);
  assert.equal(grant.accessExpiresAt, 3_610_000);
  assert.deepEqual(grant.channels, [
    { channelId: id('A'), title: 'Kanal A', handle: '@contoh', url: `https://www.youtube.com/channel/${id('A')}` },
    { channelId: id('B'), title: 'Kanal B', handle: '', url: `https://www.youtube.com/channel/${id('B')}` },
  ]);
});

test('Izin parsial, masa berlaku tidak wajar, dan refresh yang hilang tidak memulai discovery', async () => {
  for (const [patch, expected] of [
    [{ scope: undefined }, 'youtube_oauth_failed'], [{ scope: 'https://www.googleapis.com/auth/youtube.upload' }, 'youtube_oauth_failed'],
    [{ expires_in: 0 }, 'youtube_oauth_failed'], [{ expires_in: 10 ** 9 }, 'youtube_oauth_failed'],
    [{ refresh_token: undefined }, 'reconnect_required'], [{ refresh_token: '' }, 'reconnect_required'],
  ] as const) {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({ ...token, ...patch }); };
    await assert.rejects(exchangeYouTubeGrant(config, code, verifier, { fetcher }), (error: unknown) => error instanceof ApiError && error.code === expected && !error.message.includes(refresh));
    assert.equal(calls, 1);
  }
});

test('Grant dengan scope tambahan gagal sebelum discovery dan menyembunyikan payload Google', async () => {
  const providerPayload = 'fixture-google-payload';
  for (const extraScope of [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.upload',
    'openid',
    'fixture-unknown-scope',
  ]) {
    const urls: string[] = [];
    const fetcher: typeof fetch = async input => {
      urls.push(String(input));
      return Response.json({
        ...token,
        scope: `${YOUTUBE_READONLY_SCOPE} ${extraScope}`,
        extra: providerPayload,
      });
    };
    await assert.rejects(exchangeYouTubeGrant(config, code, verifier, { fetcher }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 502);
      assert.ok(providerError(error));
      assert.equal(error.message.includes(extraScope), false);
      assert.equal(error.message.includes(providerPayload), false);
      return true;
    });
    assert.deepEqual(urls, ['https://oauth2.googleapis.com/token']);
  }
});

test('JSON rusak, respons berlebih, kanal tidak valid, dan paginasi berulang gagal tanpa membocorkan payload', async () => {
  for (const reply of [
    () => new Response(`invalid ${access}`),
    () => new Response('x'.repeat(128 * 1024 + 1)),
    () => Response.json({ error: refresh }, { status: 400 }),
    () => Response.json({ items: [{ id: '../forged', snippet: { title: 'Kanal' } }] }),
    () => Response.json({ items: [], nextPageToken: 'repeated-cursor' }),
  ]) {
    let calls = 0;
    const fetcher: typeof fetch = async () => ++calls === 1 ? Response.json(token) : reply();
    await assert.rejects(exchangeYouTubeGrant(config, code, verifier, { fetcher }), providerError);
    assert.ok(calls <= 3);
  }
  let calls = 0;
  const fetcher: typeof fetch = async () => ++calls === 1 ? Response.json(token) : Response.json({ items: [], nextPageToken: 'cursor-' + calls });
  await assert.rejects(exchangeYouTubeGrant(config, code, verifier, { fetcher }), providerError);
  assert.equal(calls, 6);
});

test('Pembatalan akibat timeout diteruskan ke fetch dan pesan mentah disembunyikan', async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    assert.equal(init?.signal, controller.signal);
    init.signal.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    queueMicrotask(() => controller.abort(new DOMException(access, 'TimeoutError')));
  });
  await assert.rejects(exchangeYouTubeGrant(config, code, verifier, { fetcher, signal: controller.signal }), providerError);
});
