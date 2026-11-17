import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { REELS_SPEC } from '../reels-spec';
import type { AdminModelOverrides } from '../admin-settings';
import { wibDay } from './clock';
import type { ContentAgentResult } from './content-agent';
import type { ReelsArtworkFrame } from './content-compositor';
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
const maxTimingBytes = 256;
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

type Voice = { pcm: Buffer; sampleRate: 24000; model: string; sceneDurations?: number[] };
type Bucket = ReturnType<typeof adminBucket>;

// Store the reviewed result and its motion layers in one immutable object.
function packParts(parts: Buffer[]) {
  const sizes = Buffer.alloc(parts.length * 4);
  parts.forEach((part, index) => sizes.writeUInt32LE(part.length, index * 4));
  return Buffer.concat([sizes, ...parts]);
}

function unpackParts(bytes: Buffer, maxSizes: number[]): Buffer[] | null {
  let offset = maxSizes.length * 4;
  if (bytes.length < offset) return null;
  const parts: Buffer[] = [];
  for (const [index, maximum] of maxSizes.entries()) {
    const size = bytes.readUInt32LE(index * 4);
    if (size < 1 || size > maximum || offset + size > bytes.length) return null;
    parts.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  return offset === bytes.length ? parts : null;
}

function validSceneDurations(value: unknown, pcm: Buffer): value is number[] {
  return Array.isArray(value) && value.length === REELS_SPEC.sceneCount
    && value.every(seconds => typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0)
    && Math.abs(value.reduce((total, seconds) => total + seconds, 0) - pcm.length / 48_000) < 0.001;
}

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
  const voiceFile = 'voice-v2.bin';
  // A checkpoint contains the rendered type as well as the photo. A new render
  // must use the current type across every scene, even during a rolling deploy.
  const frameFile = (index: number, version = 7) => `frame-v${version}-${index}.bin`;
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
    async frame(index: number, render: () => Promise<ReelsArtworkFrame>): Promise<ReelsArtworkFrame> {
      if (!Number.isInteger(index) || index < 0 || index >= REELS_SPEC.sceneCount) {
        throw new RangeError('Indeks adegan checkpoint Reels tidak valid.');
      }
      const name = frameFile(index);
      const cached = resuming ? await read(name, 3 * maxFrameBytes + 12) : null;
      const parts = cached && unpackParts(cached, [maxFrameBytes, maxFrameBytes, maxFrameBytes]);
      if (parts) {
        const [image, photo, overlay] = parts;
        const metadata = await Promise.all(parts.map(part => sharp(part, { limitInputPixels: 720 * 1280 }).metadata().catch(() => null)));
        if (metadata.every((item, index) => item?.width === 720 && item.height === 1280 &&
            (index === 2 ? item.format === 'png' && item.hasAlpha : item.format === 'jpeg'))) {
          return { image, photo, overlay };
        }
      }
      const frame = await render();
      const buffers = [frame.image, frame.photo, frame.overlay];
      if (buffers.every(bytes => bytes.length <= maxFrameBytes)) await write(name, packParts(buffers), 'application/octet-stream');
      return frame;
    },
    async voice(render: () => Promise<Voice>): Promise<Voice> {
      const cached = resuming ? await read(voiceFile, maxPcmBytes + maxTimingBytes + 8) : null;
      const parts = cached && unpackParts(cached, [maxPcmBytes, maxTimingBytes]);
      if (parts && parts[0].length % 2 === 0) {
        const [pcm, timing] = parts;
        try {
          const sceneDurations: unknown = JSON.parse(timing.toString('utf8'));
          if (sceneDurations === null) return { pcm, sampleRate: 24000, model: voiceModel };
          if (validSceneDurations(sceneDurations, pcm)) return { pcm, sampleRate: 24000, model: voiceModel, sceneDurations };
        } catch { /* A damaged checkpoint is rebuilt from the approved script. */ }
      }
      const voice = await render();
      if (voice.model === voiceModel && voice.pcm.length <= maxPcmBytes && voice.pcm.length % 2 === 0) {
        const timing = Buffer.from(JSON.stringify(validSceneDurations(voice.sceneDurations, voice.pcm) ? voice.sceneDurations : null));
        await write(voiceFile, packParts([voice.pcm, timing]), 'application/octet-stream');
      }
      return voice;
    },
    async remove() {
      const frames = Array.from({ length: REELS_SPEC.sceneCount }, (_, index) =>
        [frameFile(index), ...[6, 5, 4, 3, 2].map(version => frameFile(index, version))],
      ).flat();
      await withinStorageBudget(() => Promise.allSettled([scriptFile, ...frames, voiceFile].map(async name => {
        await file(name).delete({ ignoreNotFound: true });
      })));
    },
  };
}
