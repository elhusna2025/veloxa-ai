import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { REELS_SPEC } from '../reels-spec';
import type { AdminModelOverrides } from '../admin-settings';
import { wibDay } from './clock';
import type { ContentAgentResult } from './content-agent';
import { adminBucket } from './firebase';
import { REELS_VOICE_MODEL } from './reels-voice';

const checkpointLifetime = 30 * 60_000;
// A slot can start within 30 minutes and holds a six-minute worker lease.
const checkpointDeleteAfter = 36 * 60_000;
const checkpointRoot = 'private_reels_checkpoints/';
const storageTimeoutMs = 2_000;
const maxScriptBytes = 128 * 1024;
const maxFrameBytes = 2 * 1024 * 1024;
const maxPcmBytes = REELS_SPEC.maxSourceAudioSeconds * 48_000;
const socialChannel = z.enum(['instagram', 'facebook', 'tiktok', 'youtube_shorts']);
const savedScript = z.object({
  savedAt: z.number().int(),
  sourceKey: z.string(),
  result: z.object({
    engineMode: z.enum(['openai_live', 'deterministic_local']),
    draft: z.object({
      id: z.string(),
      workspaceId: z.string(),
      source: z.literal('autonomous_agent'),
      format: z.literal('short_video'),
      status: z.enum(['draft', 'approved', 'scheduled']),
      title: z.string().min(1),
      hook: z.string(),
      caption: z.string().min(1),
      hashtags: z.array(z.string()),
      targetChannels: z.array(socialChannel),
      channelStatuses: z.array(z.object({ channel: socialChannel, status: z.enum(['pending', 'scheduled']) })),
      usedRealAssetIds: z.array(z.string()),
      qualityReview: z.object({
        passed: z.literal(true), score: z.number(), repairAttempts: z.number(), summary: z.string(), issues: z.array(z.string()),
        checkedAspects: z.object({
          brandAlignment: z.boolean(), typographyContrast: z.boolean(), copyAccuracy: z.boolean(), styleReferenceMatch: z.boolean(),
        }),
      }),
      videoScenes: z.array(z.object({
        sceneNumber: z.number(),
        timeRange: z.string(),
        textOverlay: z.string().min(1),
        voiceover: z.string().min(1),
        visualDirection: z.string().min(1),
      }).passthrough()).length(REELS_SPEC.sceneCount),
    }).passthrough(),
  }),
});

function digest(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

type Voice = { pcm: Buffer; sampleRate: 24000; model: string };
type Bucket = ReturnType<typeof adminBucket>;

async function withinStorageBudget<T>(operation: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), storageTimeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sweepExpiredReelsCheckpoints(now: number, bucket = adminBucket) {
  const cutoff = `${checkpointRoot}${String(now).padStart(16, '0')}/`;
  const batch = await withinStorageBudget(() => bucket().getFiles({
    prefix: checkpointRoot, endOffset: cutoff, maxResults: 24, autoPaginate: false,
  }));
  if (!batch) return;
  await withinStorageBudget(() => Promise.allSettled(batch[0]
    .filter(file => file.name.startsWith(checkpointRoot) && file.name < cutoff)
    .map(file => file.delete({ ignoreNotFound: true }))));
}

export function scheduledReelsCheckpoint(
  bucket: () => Bucket,
  workspaceId: string,
  draftId: string,
  scheduledAt: number,
  source: {
    input: unknown;
    fingerprint: string;
    images: Buffer[];
    models?: AdminModelOverrides;
  },
) {
  const expiry = String(scheduledAt + checkpointDeleteAfter).padStart(16, '0');
  const modelFolder = source.models ? `${digest(JSON.stringify(source.models))}/` : '';
  const prefix = `${checkpointRoot}${expiry}/${workspaceId}/${draftId}/${modelFolder}`;
  const voiceModel = source.models?.voiceModel ?? REELS_VOICE_MODEL;
  // Each model combination gets its own immutable objects and never reuses another model's approvals.
  const sourceKey = digest(JSON.stringify({ version: 1, day: wibDay(), ...source, images: source.images.map(digest) }));
  const file = (name: string) => bucket().file(`${prefix}${name}`);
  const scriptFile = 'script.json';
  const voiceFile = 'voice.pcm';
  const frameFile = (index: number) => `frame-${index}.jpg`;
  let resuming = false;
  const read = async (name: string, maxBytes: number) => {
    const result = await withinStorageBudget(() => file(name).download());
    const bytes = result?.[0];
    return bytes && bytes.length > 0 && bytes.length <= maxBytes ? bytes : null;
  };
  const write = async (name: string, bytes: Buffer, contentType: string) => {
    const saved = await withinStorageBudget(async () => {
      await file(name).save(bytes, {
        resumable: false,
        timeout: storageTimeoutMs,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType, cacheControl: 'private, no-store' },
      });
      return true;
    });
    return saved === true;
  };
  return {
    async loadScript(): Promise<ContentAgentResult | null> {
      const bytes = await read(scriptFile, maxScriptBytes);
      if (!bytes) return null;
      try {
        const saved = savedScript.parse(JSON.parse(bytes.toString('utf8')));
        const age = Date.now() - saved.savedAt;
        resuming = saved.sourceKey === sourceKey && saved.result.draft.workspaceId === workspaceId && age >= 0 && age < checkpointLifetime;
        return resuming ? saved.result : null;
      } catch {
        return null;
      }
    },
    saveScript(result: ContentAgentResult) {
      const saved = { savedAt: Date.now(), sourceKey, result };
      if (!savedScript.safeParse(saved).success) return Promise.resolve(false);
      const bytes = Buffer.from(JSON.stringify(saved));
      return bytes.length <= maxScriptBytes ? write(scriptFile, bytes, 'application/json') : Promise.resolve(false);
    },
    async frame(index: number, render: () => Promise<Buffer>) {
      if (!Number.isInteger(index) || index < 0 || index >= REELS_SPEC.sceneCount) {
        throw new RangeError('Indeks adegan checkpoint Reels tidak valid.');
      }
      const name = frameFile(index);
      const cached = resuming ? await read(name, maxFrameBytes) : null;
      if (cached) {
        const metadata = await sharp(cached, { limitInputPixels: 720 * 1280 }).metadata().catch(() => null);
        if (metadata?.format === 'jpeg' && metadata.width === 720 && metadata.height === 1280) return cached;
      }
      const bytes = await render();
      if (bytes.length <= maxFrameBytes) await write(name, bytes, 'image/jpeg');
      return bytes;
    },
    async voice(render: () => Promise<Voice>): Promise<Voice> {
      const cached = resuming ? await read(voiceFile, maxPcmBytes) : null;
      if (cached && cached.length % 2 === 0) return { pcm: cached, sampleRate: 24000, model: voiceModel };
      const voice = await render();
      if (voice.model === voiceModel && voice.pcm.length <= maxPcmBytes && voice.pcm.length % 2 === 0) {
        await write(voiceFile, voice.pcm, 'application/octet-stream');
      }
      return voice;
    },
    async remove() {
      const frames = Array.from({ length: REELS_SPEC.sceneCount }, (_, index) => frameFile(index));
      await withinStorageBudget(() => Promise.allSettled([scriptFile, ...frames, voiceFile].map(async name => {
        await file(name).delete({ ignoreNotFound: true });
      })));
    },
  };
}
