import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { graphRequest, MetaRequestError, publishMetaImage } from './meta-graph';

test('Meta retry requires an unambiguous temporary rejection; conflicting responses stay unknown',async()=>{
  for(const [status,body,uncertain] of [
    [429,{error:{code:4,is_transient:true}},false],
    [429,{id:'400',error:{code:4,is_transient:true}},true],
    [503,{error:{code:4,is_transient:true}},true],
  ] as const){
    await assert.rejects(graphRequest('100/media_publish','fixture','POST',{creation_id:'500'},async()=>Response.json(body,{status})),
      error=>error instanceof MetaRequestError&&error.transient&&error.uncertain===uncertain);
  }
});
import { encryptMetaToken, decryptMetaToken } from './meta-crypto';
import { publicationState } from './publishing';
import { readJson } from './http';
import { requireUser, workspaceIdSchema } from './auth';
import { buildRenderedVisualSvg } from '../veloxa-visual-renderer';
import { BRAND_PRESETS, generateBrandContentDraft } from '../veloxa-engine';

const common = { accountId: '123456', token: 'test-token-not-real', imageUrl: 'https://media.example.test/post.jpg', caption: 'Caption yang sudah ditinjau' };

test('Facebook sends JPEG bytes and the reviewed caption; no token appears in URLs', async () => {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /123456\/photos$/);
    assert.equal(String(url).includes(common.token), false);
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${common.token}`);
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get('caption'), common.caption);
    assert.equal(init.body.get('published'), 'true');
    assert.ok(init.body.get('source') instanceof Blob);
    assert.deepEqual(Buffer.from(await (init.body.get('source') as Blob).arrayBuffer()), image);
    return Response.json({ id: '900', post_id: '123456_900' });
  };
  const result = await publishMetaImage({ ...common, channel: 'facebook', imageBytes: image }, { fetcher });
  assert.equal(calls, 1); assert.equal(result.externalPostId, '123456_900');
});

test('Instagram waits for media readiness before publishing and returns the actual ID/permalink', async () => {
  const calls: string[] = []; let poll = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path.endsWith('/123456/media')) {
      assert.equal((init?.body as URLSearchParams).get('image_url'), common.imageUrl);
      return Response.json({ id: '700' });
    }
    if (path.endsWith('/700')) return Response.json({ status_code: ++poll === 1 ? 'IN_PROGRESS' : 'FINISHED' });
    if (path.endsWith('/123456/media_publish')) { assert.equal(poll, 2); assert.equal((init?.body as URLSearchParams).get('creation_id'), '700'); return Response.json({ id: '800' }); }
    if (path.endsWith('/800')) return Response.json({ permalink: 'https://www.instagram.com/p/actual-test-id/' });
    throw new Error('Unexpected Meta request');
  };
  const result = await publishMetaImage({ ...common, channel: 'instagram' }, { fetcher, sleep: async () => {} });
  assert.equal(result.externalPostId, '800'); assert.match(result.permalink!, /actual-test-id/);
  assert.equal(calls.length, 5);
});

test('failed Instagram container processing never calls media_publish', async () => {
  let publishCalled = false;
  const fetcher: typeof fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/media')) return Response.json({ id: '700' });
    if (path.endsWith('/media_publish')) publishCalled = true;
    return Response.json({ status_code: 'ERROR' });
  };
  await assert.rejects(publishMetaImage({ ...common, channel: 'instagram' }, { fetcher }), /gagal memproses/);
  assert.equal(publishCalled, false);
});

test('an ambiguous publish response is not represented as success or as safe to retry', async () => {
  const fetcher: typeof fetch = async () => { throw new Error('timeout'); };
  await assert.rejects(graphRequest('123456/media_publish', common.token, 'POST', { creation_id: '700' }, fetcher), error => error instanceof MetaRequestError && error.uncertain);
  await assert.rejects(graphRequest('123456/photos', common.token, 'POST', {}, async () => Response.json({ error: { code: 2 } }, { status: 503 })), error => error instanceof MetaRequestError && error.uncertain);
});

test('provider rejection is explicit and provider error text cannot leak secrets', async () => {
  await assert.rejects(graphRequest('123456/photos', common.token, 'POST', {}, async () => Response.json({ error: { code: 190, message: common.token } }, { status: 400 })), error => error instanceof MetaRequestError && !error.uncertain && !error.message.includes(common.token));
});

test('only all confirmed receipts make a draft published', () => {
  assert.equal(publicationState([]), 'publish_failed');
  assert.equal(publicationState([{ channel: 'facebook', status: 'published' }, { channel: 'instagram', status: 'failed' }]), 'partially_published');
  assert.equal(publicationState([{ channel: 'facebook', status: 'published' }, { channel: 'instagram', status: 'unknown' }]), 'needs_attention');
  assert.equal(publicationState([{ channel: 'facebook', status: 'published' }, { channel: 'instagram', status: 'published' }]), 'published');
});

test('stored Meta credentials are authenticated ciphertext bound to one workspace', () => {
  const previous = process.env.META_TOKEN_ENCRYPTION_KEY;
  process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  try {
    const encrypted = encryptMetaToken(common.token, 'workspace-a');
    assert.equal(encrypted.includes(common.token), false);
    assert.equal(decryptMetaToken(encrypted, 'workspace-a'), common.token);
    assert.throws(() => decryptMetaToken(encrypted, 'workspace-b'));
    assert.notEqual(encryptMetaToken(common.token, 'workspace-a'), encrypted);
  } finally { if (previous === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY; else process.env.META_TOKEN_ENCRYPTION_KEY = previous; }
});

test('request guards reject missing authentication, oversized JSON, and path injection', async () => {
  await assert.rejects(requireUser(new Request('http://localhost/api')), error => typeof error === 'object' && error !== null && 'status' in error && error.status === 401);
  await assert.rejects(readJson(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ oversized: 'x'.repeat(100) }) }), 30));
  assert.equal(workspaceIdSchema.safeParse('../another-workspace').success, false);
});

test('rendered post is a real JPEG with dimensions accepted by Instagram', async () => {
  const brand = BRAND_PRESETS.cafe_fnb;
  const draft = generateBrandContentDraft({ brand, format: 'single_post', source: 'manual_studio', vaultAssets: [], connections: [], planId: 'free_trial' });
  const shortVisualDraft = { ...draft, slides: undefined, title: 'Pilihan menu Kopi Senja', hook: 'Kenali pilihan menu melalui akun resmi Kopi Senja.' };
  const svg = buildRenderedVisualSvg({ brand, draft: shortVisualDraft });
  assert.throws(() => buildRenderedVisualSvg({ brand, draft: { ...shortVisualDraft, hook: 'Fakta penting 123 '.repeat(30) } }), /Teks visual terlalu panjang/);
  assert.equal(svg.includes('Kualitas AI'), false);
  const bytes = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1350); assert.equal(metadata.format, 'jpeg');
  assert.ok(bytes.length < 8 * 1024 * 1024);
});
