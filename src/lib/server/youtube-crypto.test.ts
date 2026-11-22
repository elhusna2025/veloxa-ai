import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from './http';
import { decryptYouTubeTokens, encryptYouTubeTokens } from './youtube-crypto';

const key = Buffer.alloc(32, 42);
const pair = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' };
const context = { workspaceId: 'workspace-test', businessId: 'primary', authorizationId: 'fixture-grant' };
const reconnect = (error: unknown) => error instanceof ApiError && error.code === 'reconnect_required' && !error.message.includes(pair.refreshToken);

test('AES-GCM menyembunyikan pasangan token dan mengikatnya ke workspace, bisnis, dan grant', () => {
  const encrypted = encryptYouTubeTokens(pair, context, key);
  assert.notEqual(encrypted, encryptYouTubeTokens(pair, context, key));
  assert.equal(encrypted.includes(pair.accessToken) || encrypted.includes(pair.refreshToken), false);
  assert.deepEqual(decryptYouTubeTokens(encrypted, context, key), pair);
  for (const field of Object.keys(context)) {
    assert.throws(() => decryptYouTubeTokens(encrypted, { ...context, [field]: 'different' }, key), reconnect);
  }
  assert.throws(() => decryptYouTubeTokens(encrypted, context, Buffer.alloc(32, 7)), reconnect);
  const [iv, tag, data] = encrypted.split('.');
  const bytes = Buffer.from(data, 'base64url');
  bytes[0] ^= 1;
  for (const invalid of [`${iv}.${tag}.${bytes.toString('base64url')}`, `${iv}.${tag.slice(1)}.${data}`, `${iv}=.${tag}.${data}`]) {
    assert.throws(() => decryptYouTubeTokens(invalid, context, key), reconnect);
  }
});
