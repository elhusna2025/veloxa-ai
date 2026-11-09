import test from 'node:test';
import assert from 'node:assert/strict';
import { graphRequest, publishMetaImage } from './meta-graph';
import { publishMetaCarousel } from './meta-carousel';
import { publishMetaReel } from './meta-reels';

const common = { accountId: '123456', token: '[REDACTED]', caption: 'Caption ditinjau' };
const image = { imageUrl: 'https://media.example.test/scene.jpg', imageBytes: Buffer.from('unit-test-image') };
const sleep = async () => {};
for (const provider of ['facebook', 'instagram', 'instagram_unified'] as const) {
  for (const format of ['single_post', 'carousel', 'short_video'] as const) {
    test(`${format} Instagram uses ${provider} origin throughout container, poll, publish, and receipt`, async () => {
      const paths: string[] = []; let nextId = 700;
      const fetcher: typeof fetch = async (input, init) => {
        const url = new URL(String(input)); paths.push(url.pathname);
        assert.equal(url.hostname, provider === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com');
        assert.equal(url.href.includes(common.token), false);
        assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${common.token}`);
        assert.equal(init?.redirect, 'error');
        if (url.pathname.endsWith('/media')) return Response.json({ id: String(nextId++) });
        if (url.pathname.endsWith('/media_publish')) return Response.json({ id: '900' });
        if (url.pathname.endsWith('/900')) return Response.json({ permalink: 'https://www.instagram.com/p/verified/' });
        return Response.json({ status_code: 'FINISHED' });
      };
      const params = { ...common, channel: 'instagram' as const, loginProvider: provider };
      const result = format === 'single_post' ? await publishMetaImage({ ...params, ...image }, { fetcher, sleep })
        : format === 'carousel' ? await publishMetaCarousel({ ...params, images: Array.from({length:5}, () => image) }, { fetcher, sleep })
        : await publishMetaReel({ ...params, videoUrl: 'https://media.example.test/reel.mp4', videoBytes: Buffer.from('unit-test-mp4') }, { fetcher, sleep });
      assert.equal(result.externalPostId, '900');
      assert.equal(paths.filter(p => p.endsWith('/media_publish')).length, 1);
      assert.equal(result.permalink, 'https://www.instagram.com/p/verified/');
    });
  }
}
test('invalid provider and Instagram credentials for Facebook are rejected without dispatch', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
  await assert.rejects(graphRequest('me', common.token, 'GET', {}, fetcher, 'arbitrary-origin' as never));
  const params = { ...common, channel: 'facebook' as const, loginProvider: 'instagram' as const };
  await assert.rejects(publishMetaImage({ ...params, ...image }, { fetcher }));
  await assert.rejects(publishMetaCarousel({ ...params, images: Array.from({length:5}, () => image) }, { fetcher }));
  await assert.rejects(publishMetaReel({ ...params, videoUrl: 'https://media.example.test/reel.mp4', videoBytes: Buffer.from('unit-test-mp4') }, { fetcher }));
  assert.equal(calls, 0);
});
