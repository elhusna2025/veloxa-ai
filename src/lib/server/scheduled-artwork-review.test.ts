import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import sharp from 'sharp';
import { passesScheduledArtworkReview, SCHEDULED_ARTWORK_REVIEW_BUDGET_MS, scheduledArtworkRepairFeedback, verifyScheduledArtwork } from './scheduled-artwork-review';
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

test('scheduled post, carousel and Reels retry a timeout on the exact same artwork within one budget', async t => {
  t.mock.method(console, 'warn', () => {});
  const photo = await sharp({ create: { width: 9, height: 16, channels: 3, background: '#202090' } }).jpeg().toBuffer();
  const cases = [
    { name: 'post', params, visibleCopy: copy },
    { name: 'carousel', params: { ...params, carouselSlide: true }, visibleCopy: copy },
    { name: 'Reels', params: { ...params, aspectRatio: '9:16' as const, scheduledReelsPhotoOnly: true }, visibleCopy: '' },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const calls: { request: OpenAI.Responses.ResponseCreateParamsNonStreaming; options: { timeout: number; maxRetries: number; signal: AbortSignal } }[] = [];
    const client = { responses: { create: async (request: typeof calls[number]['request'], options: typeof calls[number]['options']) => {
      calls.push({ request, options });
      if (calls.length === 1) throw new OpenAI.APIConnectionTimeoutError();
      return { status: 'completed', output_text: JSON.stringify({ visibleCopy: scenario.visibleCopy, layoutPasses: true, layoutReason: '' }) };
    } } } as never;
    await verifyScheduledArtwork(photo, scenario.params, scenario.name === 'Reels' ? photo : undefined, client);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].request, calls[1].request);
    assert.equal(calls[0].request.model, 'gpt-6-luna');
    assert.deepEqual(calls[0].request.reasoning, { effort: 'low' });
    assert.equal(calls[0].request.max_output_tokens, 4_000);
    assert.equal(calls[0].options.signal, calls[1].options.signal);
    assert.ok(calls.every(({ options }) => options.timeout > 0 && options.timeout <= 30_000 && options.maxRetries === 0));
  });
});

test('scheduled carousel retries a transient provider HTTP failure without SDK retries', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  const requests: unknown[] = [];
  const client = new OpenAI({ apiKey: 'not-a-real-key', maxRetries: 5, fetch: async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) return Response.json({ error: { message: 'private-provider-error' } }, { status: 503 });
    return Response.json({ object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{
      type: 'output_text', text: JSON.stringify({ visibleCopy: copy, layoutPasses: true, layoutReason: '' }),
    }] }] });
  } });
  await verifyScheduledArtwork(Buffer.from('same-finished-bytes'), { ...params, carouselSlide: true }, undefined, client);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  const log = JSON.parse(String(warning.mock.calls[0].arguments[0]));
  assert.equal(log.reason, 'provider_http');
  assert.equal(log.providerStatus, 503);
  assert.equal(log.scope, 'scheduled');
  assert.equal(log.format, 'carousel');
  assert.doesNotMatch(JSON.stringify(log), /private-provider-error|same-finished-bytes/);
});

test('token truncation retries the same image with more output room and safe token diagnostics', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  const requests: OpenAI.Responses.ResponseCreateParamsNonStreaming[] = [];
  const sensitiveBody = 'private-incomplete-OCR';
  const client = { responses: { create: async (request: typeof requests[number]) => {
    requests.push(request);
    return requests.length === 1
      ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: sensitiveBody,
        usage: { output_tokens: 4_000, output_tokens_details: { reasoning_tokens: 3_990 } } }
      : { status: 'completed', output_text: JSON.stringify({ visibleCopy: copy, layoutPasses: true, layoutReason: '' }) };
  } } } as never;
  await verifyScheduledArtwork(Buffer.from('same-finished-bytes'), params, undefined, client);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].input, requests[1].input);
  assert.deepEqual(requests.map(request => request.max_output_tokens), [4_000, 6_000]);
  const log = JSON.parse(String(warning.mock.calls[0].arguments[0]));
  assert.equal(log.reason, 'response_token_limit');
  assert.equal(log.incompleteReason, 'max_output_tokens');
  assert.equal(log.outputTokens, 4_000);
  assert.equal(log.reasoningTokens, 3_990);
  assert.doesNotMatch(JSON.stringify(log), /private-incomplete-OCR|same-finished-bytes/);
});

test('repeated incomplete results exhaust two attempts and never become an artwork rejection or pass', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  for (const reason of ['max_output_tokens', 'other-private-incomplete-reason']) await t.test(reason, async () => {
    let attempts = 0;
    const client = { responses: { create: async () => {
      attempts++;
      return { status: 'incomplete', incomplete_details: { reason },
        output_text: JSON.stringify({ visibleCopy: copy, layoutPasses: true, layoutReason: '' }),
        usage: { output_tokens: 4_000, output_tokens_details: { reasoning_tokens: 3_990 } } };
    } } } as never;
    const error: unknown = await verifyScheduledArtwork(Buffer.from('exact-image'), params, undefined, client).catch(error => error);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'scheduled_artwork_review_unavailable');
    assert.equal(scheduledArtworkRepairFeedback(error), undefined);
    assert.equal(attempts, 2);
  });
  const logs = warning.mock.calls.map(call => String(call.arguments[0]));
  assert.equal(logs.length, 4);
  assert.equal(JSON.parse(logs[1]).reason, 'response_token_limit');
  assert.equal(JSON.parse(logs[3]).incompleteReason, 'other');
  assert.ok(logs.every(log => !log.includes('other-private-incomplete-reason') && !log.includes(copy)));
});

test('a transient invalid structured result can recover only from a valid completed second review', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  let attempts = 0;
  const client = { responses: { create: async () => ({ status: 'completed', output_text: JSON.stringify(++attempts === 1
    ? { visibleCopy: copy, layoutPasses: 'true', layoutReason: '' }
    : { visibleCopy: copy, layoutPasses: true, layoutReason: '' }) }) } } as never;
  await verifyScheduledArtwork(Buffer.from('same-finished-bytes'), params, undefined, client);
  assert.equal(attempts, 2);
  assert.equal(JSON.parse(String(warning.mock.calls[0].arguments[0])).reason, 'invalid_response');
});

test('HTTP configuration errors and content filtering are terminal without transport retries', async t => {
  t.mock.method(console, 'warn', () => {});
  for (const scenario of ['configuration', 'filter']) await t.test(scenario, async () => {
    let attempts = 0;
    const client = { responses: { create: async () => {
      attempts++;
      if (scenario === 'configuration') throw new OpenAI.BadRequestError(400, { message: 'private-provider-error' }, undefined, new Headers());
      return { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output_text: '' };
    } } } as never;
    await assert.rejects(verifyScheduledArtwork(Buffer.from('same-finished-bytes'), params, undefined, client), {
      status: 503, code: 'scheduled_artwork_review_unavailable',
    });
    assert.equal(attempts, 1);
  });
});

test('a second review request receives only the remaining overall time', async t => {
  t.mock.method(console, 'warn', () => {});
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const timeouts: number[] = [];
  const client = { responses: { create: async (_request: unknown, options: { timeout: number }) => {
    timeouts.push(options.timeout);
    if (timeouts.length === 1) {
      now += 30_000;
      throw new OpenAI.APIConnectionTimeoutError();
    }
    return { status: 'completed', output_text: JSON.stringify({ visibleCopy: copy, layoutPasses: true, layoutReason: '' }) };
  } } } as never;
  await verifyScheduledArtwork(Buffer.from('same-finished-bytes'), params, undefined, client);
  assert.deepEqual(timeouts, [30_000, SCHEDULED_ARTWORK_REVIEW_BUDGET_MS - 30_000]);
});

test('the shared deadline blocks a late completed review and does not start a second request', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  let attempts = 0;
  const client = { responses: { create: async () => {
    attempts++;
    now += SCHEDULED_ARTWORK_REVIEW_BUDGET_MS;
    return { status: 'completed', output_text: JSON.stringify({ visibleCopy: copy, layoutPasses: true, layoutReason: '' }) };
  } } } as never;
  await assert.rejects(verifyScheduledArtwork(Buffer.from('same-finished-bytes'), params, undefined, client), {
    status: 503, code: 'scheduled_artwork_review_unavailable',
  });
  assert.equal(attempts, 1);
  assert.equal(JSON.parse(String(warning.mock.calls[0].arguments[0])).reason, 'provider_deadline');
});

test('completed layout and exact-copy rejections never trigger a transport retry', async t => {
  const warning = t.mock.method(console, 'warn', () => {});
  for (const result of [
    { visibleCopy: copy, layoutPasses: false, layoutReason: 'Title covers a face.' },
    { visibleCopy: copy + ' DISKON', layoutPasses: true, layoutReason: '' },
  ]) {
    let attempts = 0;
    const client = { responses: { create: async () => {
      attempts++;
      return { status: 'completed', output_text: JSON.stringify(result) };
    } } } as never;
    await assert.rejects(verifyScheduledArtwork(Buffer.from('exact-image'), params, undefined, client), {
      status: 422, code: 'scheduled_artwork_rejected',
    });
    assert.equal(attempts, 1);
  }
  assert.equal(warning.mock.callCount(), 0);
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
  assert.equal(warning.mock.callCount(), 2);
  const logs = warning.mock.calls.map(call => String(call.arguments[0]));
  assert.deepEqual(logs.map(log => JSON.parse(log).event), ['artwork_visual_review_retry', 'studio_reels_visual_review_unavailable']);
  assert.ok(logs.every(log => JSON.parse(log).reason === 'invalid_response' && !log.includes(sensitiveBody)));
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
