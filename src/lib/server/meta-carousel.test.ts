import test from 'node:test';
import assert from 'node:assert/strict';
import { publishMetaCarousel } from './meta-carousel';
import { MetaRequestError } from './meta-graph';

const images = Array.from({ length: 5 }, (_, index) => ({
  imageUrl: `https://media.example.test/${index + 1}.jpg`,
  imageBytes: Buffer.from([index + 1]),
}));
const common = { accountId: '123456', token: 'test-token', images, caption: 'Carousel yang sudah ditinjau' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const graphPath = (input: URL | RequestInfo) => new URL(String(input)).pathname.split('/').slice(2).join('/');
const formValues = (init?: RequestInit) => new URLSearchParams(init?.body as URLSearchParams);

test('Instagram menunggu setiap child dan parent selesai sebelum publish', async () => {
  const calls: { path: string; method: string; values?: URLSearchParams }[] = [];
  let childCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const path = graphPath(input);
    const method = init?.method || 'GET';
    const values = method === 'POST' ? formValues(init) : undefined;
    calls.push({ path, method, values });
    if (path === '123456/media' && values?.has('image_url')) return json({ id: String(++childCount) });
    if (path === '123456/media' && values?.get('media_type') === 'CAROUSEL') return json({ id: '900' });
    if (/^[1-5]$/.test(path) && method === 'GET') return json({ status_code: 'FINISHED' });
    if (path === '900') return json({ status_code: 'FINISHED' });
    if (path === '123456/media_publish') return json({ id: '901' });
    if (path === '901') return json({ permalink: 'https://instagram.com/p/example' });
    assert.fail(`Permintaan tidak diharapkan: ${method} ${path}`);
  };
  const result = await publishMetaCarousel({ ...common, channel: 'instagram' }, { fetcher, sleep: async () => {} });
  assert.equal(result.externalPostId, '901');
  assert.equal(result.permalink, 'https://instagram.com/p/example');
  const childCalls = calls.filter(call => call.path === '123456/media' && call.values?.has('image_url'));
  assert.deepEqual(childCalls.map(call => call.values?.get('image_url')), images.map(image => image.imageUrl));
  assert.deepEqual(childCalls.map(call => call.values?.get('is_carousel_item')), Array(5).fill('true'));
  const parentIndex = calls.findIndex(call => call.values?.get('media_type') === 'CAROUSEL');
  assert.equal(calls[parentIndex].values?.get('children'), '1,2,3,4,5');
  const childStatusIndices = childCalls.map((_, index) => calls.findIndex(call => call.path === String(index + 1) && call.method === 'GET'));
  assert.ok(childStatusIndices.every(index => index >= 0 && index < parentIndex));
  assert.ok(calls.findIndex(call => call.path === '900' && call.method === 'GET') < calls.findIndex(call => call.path === '123456/media_publish'));
});

test('Facebook mengunggah lima foto unpublished berurutan sebelum satu feed post', async () => {
  const calls: { path: string; method: string; body?: FormData | URLSearchParams }[] = [];
  let photoCount = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const path = graphPath(input);
    const method = init?.method || 'GET';
    const body = init?.body instanceof FormData ? init.body : method === 'POST' ? formValues(init) : undefined;
    calls.push({ path, method, body });
    if (path === '123456/photos') {
      assert.ok(body instanceof FormData);
      assert.equal(body.get('published'), 'false');
      return json({ id: String(++photoCount) });
    }
    if (path === '123456/feed') {
      assert.ok(body instanceof URLSearchParams);
      assert.equal(body.get('message'), common.caption);
      assert.deepEqual(JSON.parse(body.get('attached_media')!), [1, 2, 3, 4, 5].map(id => ({ media_fbid: String(id) })));
      return json({ id: '123456_789' });
    }
    assert.fail(`Permintaan tidak diharapkan: ${method} ${path}`);
  };
  const result = await publishMetaCarousel({ ...common, channel: 'facebook' }, { fetcher });
  assert.equal(result.externalPostId, '123456_789');
  assert.equal(result.permalink, 'https://www.facebook.com/123456_789');
  assert.equal(calls.filter(call => call.path === '123456/photos').length, 5);
  assert.equal(calls.at(-1)?.path, '123456/feed');
});

test('kegagalan unggahan sebelum feed bersifat pasti dan tidak menerbitkan post', async () => {
  let uploads = 0;
  let feedCalls = 0;
  const fetcher: typeof fetch = async input => {
    const path = graphPath(input);
    if (path === '123456/photos' && ++uploads === 3) return json({ error: { code: 1 } }, 500);
    if (path === '123456/photos') return json({ id: String(uploads) });
    if (path === '123456/feed') feedCalls++;
    return json({ id: 'unexpected' });
  };
  await assert.rejects(publishMetaCarousel({ ...common, channel: 'facebook' }, { fetcher }), error => error instanceof MetaRequestError && !error.uncertain);
  assert.equal(uploads, 3);
  assert.equal(feedCalls, 0);
});

test('timeout pada final feed menandai hasil tidak pasti', async () => {
  let feedCalls = 0;
  const fetcher: typeof fetch = async input => {
    const path = graphPath(input);
    if (path === '123456/photos') return json({ id: String(++feedCalls) });
    if (path === '123456/feed') { feedCalls++; throw new TypeError('simulated timeout'); }
    return json({});
  };
  await assert.rejects(publishMetaCarousel({ ...common, channel: 'facebook' }, { fetcher }), error => error instanceof MetaRequestError && error.uncertain);
  assert.equal(feedCalls, 6);
});

test('respons tanpa ID publikasi tidak pernah dianggap sukses', async () => {
  const cases: { channel: 'facebook' | 'instagram'; fetcher: typeof fetch }[] = [
    { channel: 'facebook', fetcher: async input => graphPath(input) === '123456/photos' ? json({ id: '1' }) : json({}) },
    { channel: 'instagram', fetcher: async (input, init) => {
      const path = graphPath(input);
      if (path === '123456/media' && new URLSearchParams(init?.body as URLSearchParams).has('image_url')) return json({ id: '10' });
      if (path === '123456/media') return json({ id: '20' });
      if (path === '10' || path === '20') return json({ status_code: 'FINISHED' });
      if (path === '123456/media_publish') return json({});
      return json({});
    } },
  ];
  for (const item of cases) {
    await assert.rejects(publishMetaCarousel({ ...common, channel: item.channel }, { fetcher: item.fetcher, sleep: async () => {} }), error => error instanceof MetaRequestError && error.uncertain);
  }
});

test('validasi seluruh gambar berlangsung sebelum permintaan jaringan', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return json({}); };
  await assert.rejects(publishMetaCarousel({ ...common, channel: 'facebook', images: images.slice(0, 4) }, { fetcher }));
  await assert.rejects(publishMetaCarousel({ ...common, channel: 'instagram', images: images.map((image, index) => index ? image : { ...image, imageUrl: 'http://media.example.test/1.jpg' }) }, { fetcher }));
  assert.equal(calls, 0);
});
