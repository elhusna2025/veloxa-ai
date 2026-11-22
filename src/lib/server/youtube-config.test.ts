import test from 'node:test';
import assert from 'node:assert/strict';
import { isYouTubeConfigured, youtubeConfig, youtubeRedirect } from './youtube-config';

const redirect = 'https://veloxa.example.test/api/veloxa/youtube/callback';
const key = Buffer.alloc(32).toString('base64');
const env = {
  YOUTUBE_OAUTH_ENABLED: 'true', YOUTUBE_CLIENT_ID: 'test-client', YOUTUBE_CLIENT_SECRET: 'fixture-client-secret',
  YOUTUBE_REDIRECT_URI: redirect, YOUTUBE_TOKEN_ENCRYPTION_KEY: key,
};

test('YouTube hanya dikonfigurasi jika seluruh variabel server valid', () => {
  assert.equal(isYouTubeConfigured(env), true);
  assert.equal(youtubeConfig(env)?.origin, 'https://veloxa.example.test');
  for (const name of Object.keys(env)) assert.equal(isYouTubeConfigured({ ...env, [name]: undefined }), false, name);
  for (const invalid of [key.slice(0, -1), key.slice(0, -2) + 'B=', key + '\n', Buffer.alloc(31).toString('base64')]) {
    assert.equal(isYouTubeConfigured({ ...env, YOUTUBE_TOKEN_ENCRYPTION_KEY: invalid }), false);
  }
  assert.notEqual(youtubeConfig(env)?.configBinding, youtubeConfig({ ...env, YOUTUBE_CLIENT_SECRET: 'fixture-rotated-client-secret' })?.configBinding);
  assert.notEqual(youtubeConfig(env)?.configBinding, youtubeConfig({ ...env, YOUTUBE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') })?.configBinding);
});

test('Callback terdaftar harus HTTPS dengan path persis tanpa normalisasi, query, fragmen, atau kredensial', () => {
  for (const invalid of [redirect.replace('https:', 'http:'), redirect + '/', redirect + '?', redirect + '#', redirect + '?next=elsewhere', redirect.replace('https://', 'https://user:fixture-password@'), redirect.replace('https://', 'https://@'), redirect.replace('/api/', '/extra/../api/'), redirect + '\n']) {
    assert.equal(youtubeRedirect({ ...env, YOUTUBE_REDIRECT_URI: invalid }), null, invalid);
    assert.equal(isYouTubeConfigured({ ...env, YOUTUBE_REDIRECT_URI: invalid }), false, invalid);
  }
});
