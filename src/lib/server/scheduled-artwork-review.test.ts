import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import sharp from 'sharp';
import { passesScheduledArtworkReview, scheduledArtworkRepairFeedback, verifyScheduledArtwork } from './scheduled-artwork-review';
import { ApiError, errorResponse } from './http';

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
    brandPalette: ['#079BE5', '#FBC905'],
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
  assert.match(instructions, /Reject outlined letters/);
  assert.match(instructions, /These are allowed edge accents/);
  const metadata = JSON.parse(context.text);
  assert.equal(metadata.scene.topic, params.title);
  assert.equal(metadata.reserved.length, 2);
  assert.equal(metadata.brandCornerAccents, true);
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
  await assert.rejects(verifyScheduledArtwork(finished, { ...reels, scheduledEditorial: false }, original, client), {
    code: 'reels_photo_layout_unreadable', message: /Teks dan subjek/,
  });
  assert.equal(calls.length, 4);
});

test('Studio Reels retries a transient review failure on the same photos', async () => {
  const photo = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  const studioReels = { ...params, aspectRatio: '9:16' as const, scheduledReelsPhotoOnly: true, scheduledEditorial: false };
  const reviewResponse = (layoutPasses: boolean) => Response.json({
    object: 'response',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({
      visibleCopy: '', layoutPasses, layoutReason: layoutPasses ? '' : 'Copy overlaps the subject',
    }) }] }],
  });
  const requests: unknown[] = [];
  const client = new OpenAI({ apiKey: 'not-a-real-key', maxRetries: 0, fetch: async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) return Response.json({ error: { message: 'Service unavailable' } }, {
      status: 503, headers: { 'retry-after-ms': '1' },
    });
    return reviewResponse(requests.length === 2);
  } });

  await verifyScheduledArtwork(photo, studioReels, photo, client);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  await assert.rejects(verifyScheduledArtwork(photo, studioReels, photo, client), {
    status: 422, code: 'reels_photo_layout_unreadable',
  });
  assert.equal(requests.length, 3);
});

test('rejected Reels retain bounded literal repair observations without exposing them publicly', async () => {
  const photo = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  const reels = { ...params, aspectRatio: '9:16' as const, scheduledReelsPhotoOnly: true, scheduledEditorial: false };
  const privateReason = 'private-layout-observation: Title\u0000 overlaps\n\tthe face.\u202e ' + 'x'.repeat(1600);
  const client = { responses: { create: async () => ({ status: 'completed', output_text: JSON.stringify({
    visibleCopy: '', layoutPasses: false, layoutReason: privateReason,
  }) }) } } as never;
  const error: unknown = await verifyScheduledArtwork(photo, reels, photo, client).catch(error => error);
  assert.ok(error instanceof ApiError);
  const feedback = scheduledArtworkRepairFeedback(error);
  assert.equal(feedback?.kind, 'layout');
  assert.match(feedback!.description, /^private-layout-observation: Title overlaps the face\. /);
  assert.equal(feedback!.description.length, 1200);
  assert.doesNotMatch(feedback!.description, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
  assert.ok(Object.isFrozen(feedback));
  assert.doesNotMatch(error.message, /private-layout-observation/);
  assert.doesNotMatch(JSON.stringify(error), /private-layout-observation|description|layoutReason/);
  const publicResponse = errorResponse(error);
  assert.equal(publicResponse.status, 422);
  assert.deepEqual(await publicResponse.json(), {
    ok: false,
    error: 'Teks dan subjek pada foto Reels belum tertata dengan jelas. Coba lagi dengan arahan visual yang lebih sederhana.',
    code: 'reels_photo_layout_unreadable',
  });
  assert.equal(scheduledArtworkRepairFeedback(new ApiError(422, 'Unrelated error')), undefined);
  assert.equal(scheduledArtworkRepairFeedback({ layoutReason: privateReason }), undefined);
});

test('unexpected copy has specific private repair feedback while layout and copy gates stay closed', async () => {
  const photo = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  const reels = { ...params, aspectRatio: '9:16' as const, scheduledReelsPhotoOnly: true };
  let result = { visibleCopy: 'Diskon\u0000 80%\nHARI INI', layoutPasses: true, layoutReason: '' };
  const client = { responses: { create: async () => ({ status: 'completed', output_text: JSON.stringify(result) }) } } as never;
  const copyError: unknown = await verifyScheduledArtwork(photo, reels, photo, client).catch(error => error);
  assert.ok(copyError instanceof ApiError);
  assert.equal(copyError.code, 'scheduled_artwork_rejected');
  assert.deepEqual(scheduledArtworkRepairFeedback(copyError), {
    kind: 'unexpected_copy', description: 'Original photo contains unexpected marketing text: Diskon 80% HARI INI',
  });
  assert.doesNotMatch(JSON.stringify(await errorResponse(copyError).json()), /80%|HARI INI/);

  result = { visibleCopy: '', layoutPasses: false, layoutReason: '' };
  const layoutError: unknown = await verifyScheduledArtwork(photo, reels, photo, client).catch(error => error);
  assert.ok(layoutError instanceof ApiError);
  assert.equal(layoutError.status, 422);
  assert.equal(scheduledArtworkRepairFeedback(layoutError)?.kind, 'layout');
  assert.ok(scheduledArtworkRepairFeedback(layoutError)?.description);
});

test('feed rejection preserves layout observations or observed copy for a repair without changing acceptance', async () => {
  const photo = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  let result = { visibleCopy: copy, layoutPasses: false, layoutReason: 'Added logo obscures the main subject.' };
  const client = { responses: { create: async () => ({ status: 'completed', output_text: JSON.stringify(result) }) } } as never;
  const layoutError: unknown = await verifyScheduledArtwork(photo, params, undefined, client).catch(error => error);
  assert.ok(layoutError instanceof ApiError);
  assert.deepEqual(scheduledArtworkRepairFeedback(layoutError), {
    kind: 'layout', description: 'Added logo obscures the main subject.',
  });
  result = { visibleCopy: copy + ' DISKON', layoutPasses: true, layoutReason: '' };
  const copyError: unknown = await verifyScheduledArtwork(photo, params, undefined, client).catch(error => error);
  assert.ok(copyError instanceof ApiError);
  assert.equal(copyError.code, 'scheduled_artwork_rejected');
  assert.equal(scheduledArtworkRepairFeedback(copyError)?.kind, 'copy_mismatch');
  assert.match(scheduledArtworkRepairFeedback(copyError)!.description, /Observed copy: Berez ERP .* DISKON$/);
});

test('Studio Reels blocks a malformed review result without logging its contents', async t => {
  const photo = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  const studioReels = { ...params, aspectRatio: '9:16' as const, scheduledReelsPhotoOnly: true, scheduledEditorial: false };
  const warning = t.mock.method(console, 'warn', () => {});
  const sensitiveBody = 'example-private-provider-output';
  const client = { responses: { create: async () => ({ status: 'completed', output_text: sensitiveBody }) } } as never;

  await assert.rejects(verifyScheduledArtwork(photo, studioReels, photo, client), {
    status: 503, code: 'reels_photo_review_unavailable',
  });
  assert.equal(warning.mock.callCount(), 1);
  const log = String(warning.mock.calls[0].arguments[0]);
  assert.equal(JSON.parse(log).reason, 'invalid_response');
  assert.ok(!log.includes(sensitiveBody));
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
