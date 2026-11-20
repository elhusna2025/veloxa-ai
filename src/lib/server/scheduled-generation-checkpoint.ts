import { createHash } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { generateContentWithSavedAgent } from './content-agent';
import { generateSocialPostImage, type SocialPostImageParams } from './content-image';
import { verifyScheduledArtwork } from './scheduled-artwork-review';
import { verifyScheduledScript } from './scheduled-script-review';
import { adminBucket } from './firebase';
import { ApiError } from './http';
import { wibDay } from './clock';
import { REELS_SPEC } from '../reels-spec';
import { REELS_VOICE_MODEL } from './reels-voice';
import sharp from 'sharp';

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fingerprint = (value: unknown) => digest(JSON.stringify(value, (_key, item) =>
  item?.type === 'Buffer' && Array.isArray(item.data) ? digest(Buffer.from(item.data)) : item));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const revision = 1;
const checkpointRoot = 'private_autonomy_checkpoints/';
const retentionMs = 7 * 24 * 60 * 60_000;

async function within<T>(operation: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ApiError(503,
        'Penyimpanan progres sedang dipulihkan. Proses yang sama akan dilanjutkan otomatis.',
        'scheduled_checkpoint_unavailable')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function sweepExpiredScheduledCheckpoints(now: number, bucket = adminBucket) {
  const cutoff = `${checkpointRoot}${String(now).padStart(16, '0')}/`;
  try {
    await within(async () => {
      const [files] = await bucket().getFiles({ prefix: checkpointRoot, endOffset: cutoff, maxResults: 24, autoPaginate: false });
      await Promise.allSettled(files.filter(file => file.name.startsWith(checkpointRoot) && file.name < cutoff)
        .map(file => file.delete({ ignoreNotFound: true })));
    }, 2_000);
  } catch { /* Maintenance cannot block a scheduler tick. */ }
}

/** One immutable scheduled job retains paid work across worker invocations. */
export function scheduledGenerationCheckpoint(
  workspaceId: string,
  job: DocumentReference,
  assertActive: () => Promise<unknown>,
  updateJob: (values: Record<string, unknown>) => Promise<void>,
  bucket = adminBucket,
  providers: {
    generate?: typeof generateContentWithSavedAgent;
    renderImage?: typeof generateSocialPostImage;
    verifyArtwork?: typeof verifyScheduledArtwork;
    verifyScript?: typeof verifyScheduledScript;
  } = {},
  options: { scheduledAt?: number; storageBudgetMs?: number } = {},
) {
  const scheduledAt = options.scheduledAt ?? Number(job.id.replace(/^slot_/, ''));
  if (!Number.isFinite(scheduledAt) || scheduledAt < 0) throw new TypeError('Waktu checkpoint otomatis tidak valid.');
  const retentionWindow = Math.floor(Math.max(0, Date.now() - scheduledAt) / retentionMs) + 1;
  const prefix = `${checkpointRoot}${String(scheduledAt + retentionWindow * retentionMs).padStart(16, '0')}/${workspaceId}/${digest(job.path)}/`;
  const storageBudgetMs = options.storageBudgetMs ?? 5_000;
  const imageKey = (params: SocialPostImageParams, model?: string) => fingerprint({ revision, params, model });
  const read = async (name: string) => {
    await assertActive();
    try {
      const [bytes] = await within(() => bucket().file(prefix + name).download(), storageBudgetMs);
      await assertActive();
      return bytes as Buffer;
    } catch (error) {
      if (Number((error as { code?: unknown }).code) === 404) return null;
      throw error;
    }
  };
  const save = async (name: string, bytes: Buffer, contentType: string) => {
    await assertActive();
    await within(() => bucket().file(prefix + name).save(bytes, {
      resumable: false,
      timeout: storageBudgetMs,
      metadata: { contentType, cacheControl: 'private, no-store' },
    }), storageBudgetMs);
    await assertActive();
  };
  const rejectScript = () => updateJob({
    scriptResult: null, scriptCreationStarted: false, agentSession: null, verifiedScriptKey: null,
  });
  return {
    rejectScript,
    generate: (async (params, options) => {
      await assertActive();
      const key = fingerprint({ revision, params: { ...params, planId: undefined, connections: params.connections.map(account => ({
        connectionId: account.connectionId, accountId: account.accountId, channel: account.channel,
        loginProvider: account.loginProvider,
      })) }, model: options?.model });
      const record = (await job.get()).data()!;
      if (record.scriptKey && record.scriptKey !== key) {
        throw new ApiError(409, 'Bahan proses otomatis berubah. Konten lama belum dikirim.', 'profile_conflict');
      }
      if (record.scriptResult) return copy(record.scriptResult);
      // Keep the provider session identity. A lost creation response is never replaced blindly.
      if (record.scriptCreationStarted && !record.agentSession) {
        throw new ApiError(503, 'Identitas proses naskah sedang diperiksa.', 'content_agent_creation_uncertain');
      }
      await updateJob({ scriptKey: key });
      try {
        const result = await (providers.generate || generateContentWithSavedAgent)(params, {
          ...options,
          checkpoint: {
            beginCreation: async () => { await updateJob({ scriptCreationStarted: true }); },
            load: async () => (await job.get()).data()?.agentSession ?? null,
            save: async value => { await updateJob({ agentSession: value }); },
          },
        });
        await updateJob({ scriptResult: copy(result) });
        return result;
      } catch (error) {
        const session = (await job.get()).data()?.agentSession;
        if (error instanceof ApiError && error.code === 'invalid_content_agent_response' && session?.completed === true) {
          await rejectScript();
        }
        throw error;
      }
    }) as typeof generateContentWithSavedAgent,
    verifyScript: (async (params, client) => {
      await assertActive();
      const key = fingerprint({ revision, day: wibDay(), params });
      if ((await job.get()).data()?.verifiedScriptKey === key) return;
      try {
        await (providers.verifyScript || verifyScheduledScript)(params, client);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'scheduled_script_rejected') await rejectScript();
        throw error;
      }
      await updateJob({ verifiedScriptKey: key });
    }) as typeof verifyScheduledScript,
    renderImage: (async (params, options) => {
      const name = `image-${imageKey(params, options?.model)}.jpg`;
      const cached = await read(name);
      if (cached?.length && cached.length <= 20 * 1024 * 1024) {
        const metadata = await sharp(cached, { limitInputPixels: 30_000_000 }).metadata().catch(() => null);
        if (metadata?.format === 'jpeg' && metadata.width && metadata.height) return cached;
      }
      await assertActive();
      const bytes = await (providers.renderImage || generateSocialPostImage)(params, options);
      await save(name, bytes, 'image/jpeg');
      return bytes;
    }) as typeof generateSocialPostImage,
    async invalidateImage(params: SocialPostImageParams, model?: string) {
      await assertActive();
      await within(() => bucket().file(`${prefix}image-${imageKey(params, model)}.jpg`).delete({ ignoreNotFound: true }), storageBudgetMs);
      await assertActive();
    },
    verifyArtwork: (async (artwork, params, comparison, client) => {
      const key = fingerprint({ revision, artwork, params, comparison });
      const name = `review-${key}.json`;
      const cached = await read(name);
      if (cached?.toString('utf8') === key) return;
      await assertActive();
      await (providers.verifyArtwork || verifyScheduledArtwork)(artwork, params, comparison, client);
      await save(name, Buffer.from(key), 'application/json');
    }) as typeof verifyScheduledArtwork,
    artworkRepair: {
      async load(index: number): Promise<SocialPostImageParams['artworkRepairFeedback']> {
        if (!Number.isInteger(index) || index < 0 || index > 4) throw new RangeError('Indeks visual tidak valid.');
        await assertActive();
        const feedback = (await job.get()).data()?.[`artworkRepair${index}`];
        return feedback && ['layout', 'unexpected_copy', 'copy_mismatch'].includes(feedback.kind)
          && typeof feedback.description === 'string' && feedback.description.length <= 1200
          ? { kind: feedback.kind, description: feedback.description } : undefined;
      },
      async save(index: number, feedback: NonNullable<SocialPostImageParams['artworkRepairFeedback']>) {
        if (!Number.isInteger(index) || index < 0 || index > 4) throw new RangeError('Indeks visual tidak valid.');
        await updateJob({ [`artworkRepair${index}`]: copy(feedback) });
      },
    },
    async voice<T extends { pcm: Buffer; sampleRate: 24000; model: string; sceneDurations?: number[] }>(
      source: { sceneLines: string[]; model?: string }, generate: () => Promise<T>,
    ): Promise<T> {
      const name = `voice-${fingerprint({ revision, source })}.bin`;
      const cached = await read(name);
      const maximumPcmBytes = REELS_SPEC.maxSourceAudioSeconds * 48_000;
      if (cached && cached.length > 4 && cached.length <= maximumPcmBytes + 2052) {
        try {
          const headerBytes = cached.readUInt32LE(0);
          if (headerBytes > 0 && headerBytes <= 2048 && headerBytes < cached.length - 4) {
            const header = JSON.parse(cached.subarray(4, 4 + headerBytes).toString('utf8'));
            const pcm = cached.subarray(4 + headerBytes);
            if (header.sampleRate === 24000 && header.model === (source.model || REELS_VOICE_MODEL)
              && pcm.length > 0 && pcm.length <= maximumPcmBytes && pcm.length % 2 === 0
              && (header.sceneDurations === undefined || Array.isArray(header.sceneDurations)
                && header.sceneDurations.length === source.sceneLines.length
                && header.sceneDurations.every((seconds: unknown) => typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0)
                && Math.abs(header.sceneDurations.reduce((total: number, seconds: number) => total + seconds, 0) - pcm.length / 48_000) < 0.001)) {
              return { ...header, pcm } as T;
            }
          }
        } catch { /* A damaged private audio cache is regenerated from the same approved script. */ }
      }
      await assertActive();
      const result = await generate();
      const { pcm, ...metadata } = result;
      const header = Buffer.from(JSON.stringify(metadata));
      const size = Buffer.alloc(4); size.writeUInt32LE(header.length);
      await save(name, Buffer.concat([size, header, pcm]), 'application/octet-stream');
      return result;
    },
    async remove() {
      // Cleanup is optional after the atomic draft save; never turn that save into a failure.
      try {
        await within(async () => {
          const [files] = await bucket().getFiles({ prefix, autoPaginate: false, maxResults: 128 });
          await Promise.allSettled(files.map(file => file.delete({ ignoreNotFound: true })));
        }, Math.min(2_000, storageBudgetMs));
      } catch { /* A private checkpoint can be cleaned later without regenerating saved content. */ }
    },
  };
}
