import { createHash } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { generateContentWithSavedAgent } from './content-agent';
import { generateSocialPostImage, type SocialPostImageParams } from './content-image';
import { verifyScheduledArtwork } from './scheduled-artwork-review';
import { verifyScheduledScript } from './scheduled-script-review';
import { adminBucket, adminDb } from './firebase';
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
const sweepCursorFile = 'private_autonomy_maintenance/checkpoint_cursor.json';
const terminalStates = new Set(['published', 'failed', 'cancelled', 'skipped']);

const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

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

export async function sweepExpiredScheduledCheckpoints(
  now: number,
  bucket = adminBucket,
  readJob: (path: string) => Promise<Record<string, unknown> | undefined> = async path => (await adminDb().doc(path).get()).data(),
) {
  if (timestamp(now) === null) return;
  const cutoff = `${checkpointRoot}${String(now).padStart(16, '0')}/`;
  const deadlineAt = Date.now() + 2_000;
  const inBudget = () => Date.now() < deadlineAt;
  try {
    await within(async () => {
      const storage = bucket();
      const cursor = storage.file(sweepCursorFile);
      let after: string | undefined;
      try {
        const [bytes] = await cursor.download({ start: 0, end: 2048 });
        if (bytes.length <= 2048) {
          try {
            const value: unknown = JSON.parse(bytes.toString('utf8'));
            const saved = (value as { after?: unknown } | null)?.after;
            if (typeof saved === 'string' && saved.startsWith(checkpointRoot) && saved < cutoff
              && saved.length <= 1800 && !/[\u0000-\u001f\u007f]/.test(saved)) after = saved;
          } catch { /* A damaged maintenance cursor restarts the bounded scan. */ }
        }
      } catch (error) {
        if (Number((error as { code?: unknown }).code) !== 404) throw error;
      }
      if (!inBudget()) return;
      const [files] = await storage.getFiles({ prefix: checkpointRoot, endOffset: cutoff,
        ...(after ? { startOffset: after } : {}), maxResults: 24, autoPaginate: false });
      if (!inBudget()) return;
      const candidates = files.slice(0, 24).filter(file => file.name.startsWith(checkpointRoot) && file.name < cutoff
        && file.name.length <= 1800 && !/[\u0000-\u001f\u007f]/.test(file.name) && (!after || file.name > after));
      // Persist progress before inspecting jobs. A slow or permanently active
      // object must not keep the next tick at the front of the same page.
      await cursor.save(Buffer.from(JSON.stringify({ after: candidates.at(-1)?.name ?? null })), {
        resumable: false, timeout: Math.max(1, deadlineAt - Date.now()),
        metadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
      });
      if (!inBudget()) return;
      const jobs = new Map<string, ReturnType<typeof readJob>>();
      await Promise.allSettled(candidates.map(async file => {
        const location = /^private_autonomy_checkpoints\/(\d{16})\/([^/]{1,512})\/([a-f0-9]{64})\/(?:image-[a-f0-9]{64}\.jpg|voice-[a-f0-9]{64}\.bin|review-[a-f0-9]{64}\.json)$/.exec(file.name);
        if (!location || location[2] === '.' || location[2] === '..' || !inBudget()) return;
        const [metadata] = await file.getMetadata();
        if (!inBudget()) return;
        const jobPath = metadata.metadata?.autonomyJobPath;
        const savedAt = metadata.metadata?.savedAt;
        if (typeof jobPath !== 'string' || !/^auto_content_rules\/[A-Za-z0-9_-]{1,180}\/jobs\/slot_\d{1,16}$/.test(jobPath)
          || digest(jobPath) !== location[3] || typeof savedAt !== 'string' || !/^\d{1,16}$/.test(savedAt)) return;
        const scheduledAt = Number(jobPath.slice(jobPath.lastIndexOf('slot_') + 5));
        if (timestamp(scheduledAt) === null || Number(location[1]) !== scheduledAt + retentionMs) return;
        const savedTime = timestamp(Number(savedAt));
        const objectTime = Math.max(...[metadata.updated, metadata.timeCreated]
          .map(value => Date.parse(value || '')).filter(Number.isFinite));
        const generation = metadata.generation;
        if (savedTime === null || !Number.isFinite(objectTime) || Math.max(savedTime, objectTime) > now - retentionMs
          || !/^[1-9]\d{0,30}$/.test(String(generation))) return;
        if (!jobs.has(jobPath)) jobs.set(jobPath, readJob(jobPath));
        const job = await jobs.get(jobPath)!;
        if (!inBudget()) return;
        if (job) {
          if (typeof job.state !== 'string' || !terminalStates.has(job.state)) return;
          const finishedAt = timestamp(job.finishedAt);
          const updatedAt = timestamp(job.updatedAt);
          if (finishedAt === null && updatedAt === null
            || Math.max(finishedAt ?? 0, updatedAt ?? 0) > now - retentionMs) return;
        }
        // An object replaced after metadata inspection belongs to newer work.
        await file.delete({ ignoreNotFound: true, ifGenerationMatch: generation });
      }));
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
  const prefix = `${checkpointRoot}${String(scheduledAt + retentionMs).padStart(16, '0')}/${workspaceId}/${digest(job.path)}/`;
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
      metadata: { contentType, cacheControl: 'private, no-store', metadata: {
        autonomyJobPath: job.path, savedAt: String(Date.now()),
      } },
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
