import test from 'node:test';
import assert from 'node:assert/strict';
import { sameReviewedYouTubeFile, sameYouTubeFile, youtubeUploadEndpoint } from './youtube-upload-client';

test('upload requests reach canonical routes without a redirect for GET, POST and PUT', () => {
  const paths = ['/upload-permission', '/upload-permission/start', '/uploads',
    '/uploads/operation-1', '/uploads/operation-1/action', '/uploads/operation-1/chunk'];
  for (const path of paths) {
    const target = youtubeUploadEndpoint(path);
    assert.equal(target, `/api/veloxa/youtube${path}/`);
    assert.equal(youtubeUploadEndpoint(path + '/'), target);
  }
});

test('canonical upload routes preserve encoded scope and chunk queries before authentication', () => {
  const query = new URLSearchParams({ workspaceId: 'ws + &', businessId: 'business/a?b', index: '31' }).toString();
  const target = youtubeUploadEndpoint('/uploads/operation-1/chunk?' + query);
  const url = new URL(target, 'https://veloxa.example');
  assert.equal(url.pathname, '/api/veloxa/youtube/uploads/operation-1/chunk/');
  assert.equal(url.search, '?' + query);
  assert.deepEqual([...url.searchParams], [['workspaceId', 'ws + &'], ['businessId', 'business/a?b'], ['index', '31']]);
});


test('recovering a reviewed create matches filename and MIME while existing chunk resume matches bytes', () => {
  const reviewed = { name: 'reviewed.mp4', mimeType: 'video/mp4' as const, size: 5, chunkHashes: ['a'.repeat(64)] };
  assert.equal(sameReviewedYouTubeFile(reviewed, { ...reviewed }), true);
  for (const selected of [{ ...reviewed, name: 'renamed.mp4' }, { ...reviewed, name: 'renamed.webm', mimeType: 'video/webm' as const }]) {
    assert.equal(sameYouTubeFile(reviewed, selected), true);
    assert.equal(sameReviewedYouTubeFile(reviewed, selected), false);
  }
  const changed = { ...reviewed, chunkHashes: ['b'.repeat(64)] };
  assert.equal(sameYouTubeFile(reviewed, changed), false);
  assert.equal(sameReviewedYouTubeFile(reviewed, changed), false);
});
