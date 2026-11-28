import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './youtube-production-test-store';
import { priceYouTubeUsage, recordYouTubeUsage, withYouTubeUsage } from './youtube-production-usage';

test('standard model pricing separates cached text, images, audio and Google characters', () => {
  assert.equal(priceYouTubeUsage('script', 'gpt-6-luna', {input_tokens: 100, input_tokens_details: {cached_tokens: 20}, output_tokens: 10}).usd, 13.2 / 1e6);
  assert.equal(priceYouTubeUsage('images', 'gpt-image-2.6-sunburst', {input_tokens: 30, input_tokens_details: {text_tokens: 10, image_tokens: 20}, output_tokens: 100}).usd, 3210 / 1e6);
  assert.equal(priceYouTubeUsage('voice', 'id-ID-Chirp3-HD-Achird', undefined, 1500).usd, .045);
  assert.equal(priceYouTubeUsage('images', 'unknown', {input_tokens: 40, output_tokens: 20}).usd, null);
  assert.equal(priceYouTubeUsage('voice', 'gpt-realtime-2.1-mini', {input_tokens: 100, output_tokens: 20,
    input_token_details: {text_tokens: 50, audio_tokens: 50, cached_tokens: 20, cached_tokens_details: {audio_tokens: 20}},
    output_token_details: {audio_tokens: 20}}).usd, 736 / 1e6);
});
test('separate billed responses accumulate once per ID on their own production, including retries', async () => {
  const store = new Store();
  const ref = store.collection('jobs').doc('a');
  store.rows.set(ref.path, {state:'producing'});
  const note = (id: string) => recordYouTubeUsage('voice', 'id-ID-Chirp3-HD-Achird', undefined, id, 1000);
  await withYouTubeUsage(ref as unknown as FirebaseFirestore.DocumentReference, async () => { note('one'); note('one'); note('retry'); });
  const job = (await ref.get()).data()!;
  assert.deepEqual(job.aiUsage, {partial:true, stages:{voice:{calls:2,usd:.06,unpriced:0,input:0,output:0,characters:2000}}});
  assert.equal(job.state, 'producing');
});
