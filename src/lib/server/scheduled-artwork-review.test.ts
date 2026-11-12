import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { passesScheduledArtworkReview, verifyScheduledArtwork } from './scheduled-artwork-review';

const params = {
  businessName: 'Berez ERP',
  title: 'Catat Transaksi',
  hook: 'Satukan penjualan dan pembelian.',
  cta: 'Pelajari selengkapnya',
  website: 'berez.dafinicode.com',
};
const copy = 'Berez ERP\nCatat Transaksi\nSatukan penjualan dan pembelian.\nPelajari selengkapnya\nberez.dafinicode.com';

test('scheduled artwork requires an acceptable layout and exactly the intended visible copy', () => {
  const check = (visibleCopy: string, layoutPasses = true) => passesScheduledArtworkReview(params, { visibleCopy, layoutPasses });
  assert.equal(check(copy), true);
  assert.equal(check(copy.replace('Catat Transaksi', 'Catat Transkasi')), false);
  assert.equal(check(copy + '\n1/5 Geser untuk lanjut'), false);
  assert.equal(check(copy.replace('Satukan penjualan dan pembelian.', '')), false);
  assert.equal(check(copy, false), false);
  assert.equal(passesScheduledArtworkReview(params, { visibleCopy: copy }), false);
});

test('Reels artwork checks the short overlay and omits the narration', () => {
  const reels = { ...params, aspectRatio: '9:16' as const, cta: '', website: '' };
  assert.equal(passesScheduledArtworkReview(reels, {visibleCopy:'Berez ERP\nCatat Transaksi',layoutPasses:true}), true);
  assert.equal(passesScheduledArtworkReview(reels, {visibleCopy:'berez erp\nCatat Transaksi',layoutPasses:true}), false);
  assert.equal(passesScheduledArtworkReview(reels, {visibleCopy:'Berez ERP\nCatat Transaksi\n'+params.hook,layoutPasses:true}), false);
});

test('repaired Reels reviews layout and unexpected copy on the original photo', async () => {
  const original = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#902020' } }).jpeg().toBuffer();
  const finished = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  const reels = {
    ...params,
    aspectRatio: '9:16' as const,
    scheduledReelsPhotoOnly: true,
    hasOriginalLogo: true,
    hasOriginalScreenshot: true,
    visualDirection: 'Seorang kasir mencatat transaksi.',
  };
  type ReviewRequest = {
    instructions: string;
    input: [{ content: [{text:string}, {image_url:string}, {image_url:string}] }];
  };
  const calls: ReviewRequest[] = [];
  let response = { visibleCopy: '', layoutPasses: true, layoutReason: '' };
  const client = {
    responses: { create: async (request: ReviewRequest) => {
      calls.push(request);
      return { status: 'completed', output_text: JSON.stringify(response) };
    } },
  } as never;

  await verifyScheduledArtwork(finished, reels, original, client);
  const [{ instructions, input: [{ content: [context, firstImage, secondImage] }] }] = calls;
  assert.match(instructions, /second image only/);
  assert.match(instructions, /Do not transcribe or compare the copy in the first image/);
  assert.match(instructions, /logo and original screenshot leave faces, hands and key objects visible/);
  const metadata = JSON.parse(context.text);
  assert.equal(metadata.scene.topic, params.title);
  assert.equal(metadata.reserved.length, 2);
  assert.equal(firstImage.image_url, `data:image/jpeg;base64,${finished.toString('base64')}`);
  const comparison = Buffer.from(secondImage.image_url.split(',')[1], 'base64');
  const [red, green, blue] = await sharp(comparison).resize(1, 1).raw().toBuffer();
  assert.ok(red > 128 && green < 64 && blue < 64, 'the comparison image is the original photo');

  response = { ...response, visibleCopy: 'Diskon 80%' };
  await assert.rejects(verifyScheduledArtwork(finished, reels, original, client), {
    code: 'scheduled_artwork_rejected', message: /tulisan promosi tambahan/,
  });
  response = { visibleCopy: '', layoutPasses: false, layoutReason: 'A logo covers a face.' };
  await assert.rejects(verifyScheduledArtwork(finished, reels, original, client), {
    code: 'scheduled_artwork_rejected', message: /Tata letak akhir/,
  });
  await assert.rejects(verifyScheduledArtwork(finished, reels, undefined, client), {
    code: 'scheduled_artwork_review_unavailable',
  });
  assert.equal(calls.length, 3);
});

test('feed review uses exact final bytes, a same-sized comparison and selected reference thumbnails', async () => {
  const original = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#902020' } }).jpeg().toBuffer();
  const finished = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  const reference = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#209020' } }).jpeg().toBuffer();
  const feed = {
    ...params,
    hasOriginalLogo: true,
    hasOriginalScreenshot: true,
    visualDirection: 'Kasir mencatat penjualan di toko.',
    referenceImages: [reference],
    sceneReferenceLabels: ['Ref 1: Foto toko'],
    slideReferenceDirection: 'Pertahankan suasana toko dari referensi.',
  };
  type ImageInput = { detail: string; image_url: string };
  type ReviewRequest = { instructions: string; input: [{ content: [{ text: string }, ImageInput, ImageInput, ImageInput] }] };
  let inspected = false;
  const client = {
    responses: { create: async (request: ReviewRequest) => {
      const [context, first, second, third] = request.input[0].content;
      assert.equal(first.image_url, `data:image/jpeg;base64,${finished.toString('base64')}`);
      assert.equal(first.detail, 'high');
      const comparison = await sharp(Buffer.from(second.image_url.split(',')[1], 'base64')).metadata();
      assert.equal(comparison.width, 1080);
      assert.equal(comparison.height, 1350);
      assert.equal(second.detail, 'high');
      const thumbnail = await sharp(Buffer.from(third.image_url.split(',')[1], 'base64')).metadata();
      assert.equal(thumbnail.width, 512);
      assert.equal(thumbnail.height, 384);
      assert.equal(third.detail, 'low');
      const metadata = JSON.parse(context.text);
      assert.equal(metadata.hasComparison, true);
      assert.equal(metadata.scene.topic, feed.title);
      assert.deepEqual(metadata.scene.referenceLabels, ['Ref 1: Foto toko']);
      assert.equal(metadata.scene.slideDirection, feed.slideReferenceDirection);
      assert.match(request.instructions, /illustrates the specific scene topic/);
      inspected = true;
      return { status: 'completed', output_text: JSON.stringify({ visibleCopy: copy, layoutPasses: false, layoutReason: 'Added logo obscures the main subject.' }) };
    } },
  } as never;
  await assert.rejects(verifyScheduledArtwork(finished, feed, original, client), { code: 'scheduled_artwork_rejected' });
  assert.equal(inspected, true);
});
