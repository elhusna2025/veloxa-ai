import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { YouTubeUsageSummary } from '../youtube-production';

type Stage = 'script' | 'images' | 'voice';
type Context = { ref: FirebaseFirestore.DocumentReference; pending: Promise<void>[] };
const storage = new AsyncLocalStorage<Context>();

export async function withYouTubeUsage<T>(ref: Context['ref'], operation: () => Promise<T>) {
  const context: Context = { ref, pending: [] };
  try { return await storage.run(context, operation); }
  finally { await Promise.all(context.pending); }
}

type Units = { input: number; output: number; characters: number; usd: number | null };
// Standard on-demand USD rates as of 2026-11-28. Preserve the rate version on
// every event. Unlisted model IDs remain unpriced until their rates are verified.
// https://developers.openai.com/api/docs/pricing  https://cloud.google.com/text-to-speech/pricing
export function priceYouTubeUsage(stage: Stage, model: string, usage: unknown, characters = 0): Units {
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
  const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
  const u = obj(usage), input = count(u.input_tokens), output = count(u.output_tokens);
  const units: Units = { input, output, characters, usd: null };
  if (model === 'id-ID-Chirp3-HD-Achird' && stage === 'voice') return { ...units, usd: characters * 30 / 1e6 };
  if (typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') return units;
  const details = obj(u.input_token_details ?? u.input_tokens_details);
  let micro: number;
  if (stage === 'script' && model === 'gpt-6-luna') {
    const cached = Math.min(input, count(details.cached_tokens));
    micro = (input - cached) * .1 + cached * .01 + output * .5;
  } else if (stage === 'images' && model === 'gpt-image-2.6-sunburst') {
    const image = count(details.image_tokens), text = count(details.text_tokens);
    if (image + text !== input) return units;
    micro = image * 8 + text * 5 + output * 30;
  } else if (stage === 'voice' && model === 'gpt-realtime-2.1-mini') {
    const out = obj(u.output_token_details), cache = obj(details.cached_tokens_details);
    const cachedImage = count(cache.image_tokens), cachedAudio = count(cache.audio_tokens), cachedText = count(cache.text_tokens);
    const image = count(details.image_tokens), audio = count(details.audio_tokens), text = count(details.text_tokens);
    if (cachedImage + cachedAudio + cachedText !== count(details.cached_tokens) ||
        cachedImage > image || cachedAudio > audio || cachedText > text || image + audio + text !== input ||
        count(out.audio_tokens) + count(out.text_tokens) !== output) return units;
    micro = (image - cachedImage) * .8 + cachedImage * .08 + (audio - cachedAudio) * 10 + cachedAudio * .3
      + (text - cachedText) * .6 + cachedText * .06 + count(out.audio_tokens) * 20 + count(out.text_tokens) * 2.4;
  } else return units;
  return { ...units, usd: micro / 1e6 };
}

export function recordYouTubeUsage(stage: Stage, model: string, usage: unknown, requestId?: string, characters = 0) {
  const context = storage.getStore();
  if (!context) return;
  const { ref } = context, units = priceYouTubeUsage(stage, model, usage, characters);
  const id = createHash('sha256').update(requestId || randomUUID()).digest('hex');
  const event = ref.collection('ai_usage').doc(id);
  // Only SDK usage counters are supplied here, never prompts or response bodies.
  const measurement = { stage, model, ...units, measuredAt: Date.now(), rateDate: '2026-11-28',
    ...(usage && typeof usage === 'object' ? { providerUsage: usage } : {}) };
  context.pending.push(ref.firestore.runTransaction(async tx => {
    if ((await tx.get(event)).exists) return;
    const job = (await tx.get(ref)).data();
    if (!job) throw new Error('Missing production');
    const summary: YouTubeUsageSummary = job.aiUsage ?? { partial: true, stages: {} };
    const prev = summary.stages[stage];
    summary.stages[stage] = { calls: (prev?.calls ?? 0) + 1, usd: (prev?.usd ?? 0) + (units.usd ?? 0),
      unpriced: (prev?.unpriced ?? 0) + Number(units.usd === null), input: (prev?.input ?? 0) + units.input,
      output: (prev?.output ?? 0) + units.output, characters: (prev?.characters ?? 0) + characters };
    tx.create(event, measurement);
    tx.update(ref, { aiUsage: summary });
  }).catch(() => {
    // Retain a reconstructable receipt without rerunning a billable provider call.
    console.error('youtube_usage_receipt_unstored', { job: ref.id, id, ...measurement });
  }));
}
