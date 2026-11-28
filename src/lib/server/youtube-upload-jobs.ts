import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { YOUTUBE_CHUNK_BYTES, YOUTUBE_MAX_BYTES, type YouTubeUploadList, type YouTubeUploadOperation } from '../youtube-upload-types';
import { requireWorkspace, workspaceIdSchema } from './auth';
import { adminDb, adminBucket } from './firebase';
import { ApiError, errorResponse, noStoreJson, readJson } from './http';
import { youtubeConfigForWorkspace, type YouTubeConfig, type YouTubeEnv } from './youtube-config';
import { youtubeChannelId } from './youtube-google';
import {
  assertSingleYouTubeUploadChannel,
  assertYouTubeUploadBinding,
  getYouTubeUploadAccess,
  invalidateYouTubeUploadAccessToken,
  loadYouTubeUploadCredentials,
  readYouTubeVideoStatusBinding,
  requireYouTubeUploadBusiness,
  type YouTubeUploadBinding,
} from './youtube-upload-auth';
import { assertWorkActive, type UploadWorkSignal } from './youtube-upload-deadline';
import { readUploadChunk, uploadChunkSize, uploadMedia, withinUploadDeadline, type UploadMedia } from './youtube-upload-media';
import { readYouTubeUploadReviewCredentials } from './youtube-upload-permission';
import { YouTubeUploadTokenRejected } from './youtube-upload-records';
import {
  openYouTubeSession,
  sealYouTubeSession,
  youtubeUploadProvider,
  YouTubeRequestNotSent,
  YouTubeUploadFailure,
  type ProviderTransfer,
  type ProviderVideo,
  type YouTubeUploadProvider,
} from './youtube-upload-transfer';

const minute = 60_000;
const day = 24 * 60 * minute;
const historyTime = 30 * day;
const manualReviewOnly = Number.MAX_SAFE_INTEGER;
const leaseTime = 90_000;
const maxTries = 8;
const jobCollection = 'private_youtube_uploads';
const ownerOnly = () => new ApiError(403, 'Tindakan ini hanya tersedia untuk pemilik workspace.', 'forbidden');
const notFound = () => new ApiError(404, 'Unggahan YouTube tidak ditemukan.', 'youtube_upload_not_found');
const conflict = () => new ApiError(409, 'Proses unggah sedang berubah. Periksa status unggahan yang sama.', 'youtube_upload_conflict');
const needsPermission = 'Izin unggah YouTube untuk percobaan ini berubah. Periksa koneksi channel.';
const needsReview = 'Hasil unggah belum dapat dipastikan. Periksa channel di YouTube Studio sebelum mengirim video kembali.';
const activeOther = 'Masih ada unggahan YouTube untuk bisnis ini. Periksa unggahan sebelumnya.';
const sourceExpiredCode = 'youtube_upload_source_expired';
const expiredMessage = 'Waktu untuk unggahan ini telah berakhir. Tinjau kembali file sebelum memulai unggahan baru.';

const scope = z.object({
  workspaceId: workspaceIdSchema,
  businessId: z.string().regex(/^(primary|b_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/),
}).strict();
const operationId = z.uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.object({
  name: z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f\x7f]+$/),
  size: z.number().int().min(1).max(YOUTUBE_MAX_BYTES),
  mimeType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
  chunkHashes: z.array(hash).min(1).max(32),
}).strict().refine(item => item.chunkHashes.length === Math.ceil(item.size / YOUTUBE_CHUNK_BYTES), 'Daftar bagian video tidak lengkap.');
const metadata = z.object({
  title: z.string().refine(value => value.trim().length > 0 && [...value].length <= 100 && !/[<>]/.test(value)),
  description: z.string().refine(value => Buffer.byteLength(value, 'utf8') <= 5000 && !/[<>]/.test(value)),
  privacy: z.enum(['private', 'unlisted', 'public']),
  madeForKids: z.boolean(),
  containsSyntheticMedia: z.boolean(),
}).strict();
const createInput = scope.extend({
  operationId, channelId: youtubeChannelId, connectionRevision: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  kind: z.enum(['video', 'short']), file, metadata, confirmed: z.literal(true),
});
const actionInput = scope.extend({ action: z.enum(['process', 'check', 'cancel']) });
const chunkIndex = z.string().regex(/^(?:[0-9]|[12][0-9]|3[01])$/).transform(Number);

type Tx = FirebaseFirestore.Transaction;
type Ref = FirebaseFirestore.DocumentReference;
type Database = FirebaseFirestore.Firestore;
type Scope = z.infer<typeof scope>;
type Job = {
  id: string;
  binding: YouTubeUploadBinding;
  channelTitle: string;
  fingerprint: string;
  listKey: string;
  kind: YouTubeUploadOperation['kind'];
  file: YouTubeUploadOperation['file'];
  metadata: YouTubeUploadOperation['metadata'];
  state: YouTubeUploadOperation['state'];
  chunks: Record<string, string>;
  sourceGeneration: string | null;
  measured: YouTubeUploadOperation['measured'] | null;
  video: YouTubeUploadOperation['video'] | null;
  youtubeBytes: number;
  encryptedSession: string | null;
  finalIntent: boolean;
  attempts: number;
  sessionRestarts: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  processingUntil?: number;
  historyUntil: number;
  nextRunAt: number;
  message: string | null;
  retryAt: number | null;
  mediaCleaned: boolean;
  mediaNamespace?: string;
  reconciliationOnly?: boolean;
  totalBytes?: number;
  expectedPrivacy?: YouTubeUploadOperation['metadata']['privacy'];
  generatedSource?: GeneratedSource;
  mediaCleanupAttempts?: number;
  mediaWritePending?: string | null;
  mediaWriteUncertain?: boolean;
  mediaCleanupRecheckAt?: number | null;
  lease: { id: string; until: number } | null;
};
type GeneratedSource = { thumbnailId?: string; key: string; generation: string; size: number; width: number; height: number; durationSeconds: number };

type Dependencies = {
  database?: Database;
  env?: YouTubeEnv;
  authorize?: typeof requireWorkspace;
  uploadAccess?: typeof getYouTubeUploadAccess;
  assertBinding?: typeof assertYouTubeUploadBinding;
  credentials?: typeof loadYouTubeUploadCredentials;
  invalidateCredentials?: typeof invalidateYouTubeUploadAccessToken;
  reviewCredentials?: typeof readYouTubeUploadReviewCredentials;
  singleChannel?: typeof assertSingleYouTubeUploadChannel;
  config?: typeof youtubeConfigForWorkspace;
  provider?: YouTubeUploadProvider;
  media?: UploadMedia;
  now?: () => number;
};

const clock = (deps: Dependencies) => deps.now ?? Date.now;
const db = (deps: Dependencies) => deps.database ?? adminDb();
const media = (deps: Dependencies) => deps.media ?? uploadMedia;
const mediaKey = (job: Job, ref: Ref) => job.mediaNamespace ?? ref.id;
const reviewRetentionDue = (job: Job) => job.reconciliationOnly ? manualReviewOnly : job.historyUntil;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopeKey = ({ workspaceId, businessId }: Scope, ownerUid: string) => digest([workspaceId, businessId, ownerUid]);
const jobKey = (input: Scope, ownerUid: string, id: string) => `${scopeKey(input, ownerUid)}_${id}`;
const jobRef = (database: Database, key: string) => database.collection(jobCollection).doc(key);
const workspaceRef = (job: Job, ref: Ref) => ref.firestore.collection('workspaces').doc(job.binding.workspaceId);
const dispatchRef = (workspace: Ref, businessId: string) => workspace.collection('youtube_upload_dispatch').doc(businessId);
const admissionRef = (workspace: Ref, businessId: string) => workspace.collection('youtube_upload_admissions').doc(businessId);
const probeRef = (database: Database) => database.collection('system_operations').doc('youtube_upload_probe');
const isTerminal = (state: Job['state']) => ['ready', 'rejected', 'cancelled', 'needs_review', 'needs_permission'].includes(state);
const hasUnresolvedFinal = (job: Job) => job.finalIntent && !job.video;
const isInHistory = (job: Job, now: number) => job.historyUntil > now || hasUnresolvedFinal(job);
const mediaDeadline = (job: Job) => Math.min(job.expiresAt, job.createdAt + day);
const workDeadline = (job: Job) => job.video ? job.processingUntil ?? job.expiresAt : job.expiresAt;
const cleanupEligible = (job: Job, now: number) => !job.mediaCleaned && (job.mediaCleanupRecheckAt ?? 0) <= now;
const nextWithMediaCleanup = (job: Job, next: number) => job.mediaCleaned ? next : Math.min(next, job.mediaCleanupRecheckAt ?? mediaDeadline(job));

function nextAfterCleanup(job: Job, now: number) {
  const next = !isTerminal(job.state) ? Math.max(now, job.retryAt ?? 0)
    : hasUnresolvedFinal(job) ? reviewRetentionDue(job) : job.historyUntil;
  return nextWithMediaCleanup(job, next);
}

function getJob(snapshot: FirebaseFirestore.DocumentSnapshot): Job {
  const raw = snapshot.data() as Job | undefined;
  if (!raw?.binding || jobKey(raw.binding, raw.binding.ownerUid, raw.id) !== snapshot.id) throw notFound();
  if (!raw.reconciliationOnly) return raw;
  return { ...raw, channelTitle: 'Channel YouTube',
    file: { name: 'Video terdahulu', size: raw.totalBytes ?? 0, mimeType: 'video/mp4', chunkHashes: [] },
    metadata: { title: 'Hasil unggahan terdahulu perlu diperiksa', description: '', privacy: raw.expectedPrivacy ?? 'private', madeForKids: false, containsSyntheticMedia: false },
    chunks: {}, sourceGeneration: null, measured: null, mediaCleaned: true, mediaWritePending: null, mediaWriteUncertain: false,
  };
}

function canCancelUpload(job: Job, now: number) {
  return !job.reconciliationOnly && !job.finalIntent && !job.video && !(job.lease && job.lease.until > now)
    && (!isTerminal(job.state) || job.state === 'needs_permission');
}

function dto(job: Job, now = Date.now()): YouTubeUploadOperation {
  const { binding, file } = job;
  const missingChunks = file.chunkHashes.flatMap((_, index) => job.chunks[String(index)] ? [] : [index]);
  const stagedBytes = missingChunks.reduce((size, index) => size - uploadChunkSize(file.size, index), file.size);
  return {
    id: job.id, revision: job.revision, workspaceId: binding.workspaceId, businessId: binding.businessId,
    channelId: binding.channelId, channelTitle: job.channelTitle, connectionRevision: binding.connectionRevision,
    kind: job.kind, file, metadata: job.metadata, state: job.state, stagedBytes, youtubeBytes: job.youtubeBytes,
    totalBytes: file.size, missingChunks, createdAt: job.createdAt, updatedAt: job.updatedAt,
    canCancel: canCancelUpload(job, now), ...(job.reconciliationOnly ? { reconciliationOnly: true } : {}),
    ...(job.retryAt !== null ? { retryAt: job.retryAt } : {}),
    ...(job.message ? { message: job.message } : {}),
    ...(job.measured ? { measured: job.measured } : {}),
    ...(job.video ? { video: job.video } : {}),
  };
}

function queryScope(request: Request) {
  const query = new URL(request.url).searchParams;
  if (query.getAll('workspaceId').length !== 1 || query.getAll('businessId').length !== 1) throw new ApiError(400, 'Tentukan satu workspace dan bisnis.');
  return scope.parse({ workspaceId: query.get('workspaceId'), businessId: query.get('businessId') });
}

async function readAccess(request: Request, input: Scope, deps: Dependencies) {
  const actor = await (deps.authorize ?? requireWorkspace)(request, input.workspaceId, true);
  if (actor.workspace.ownerUid !== actor.user.uid) throw ownerOnly();
  return actor;
}

function update(tx: Tx, ref: Ref, job: Job, value: Partial<Job>, now: number) {
  const patch = { ...value, updatedAt: now, revision: job.revision + 1 };
  tx.update(ref, patch);
  return { ...job, ...patch };
}

function sameOperation(job: Job, fingerprint: string) {
  if (job.fingerprint !== fingerprint) throw new ApiError(409, 'ID unggah sudah digunakan untuk rincian yang berbeda.', 'youtube_upload_id_conflict');
  return job;
}

async function respond(run: () => Promise<unknown>) {
  try { return noStoreJson(await run()); }
  catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export function youtubeUploadsList(request: Request, deps: Dependencies = {}) {
  return respond(async (): Promise<YouTubeUploadList> => {
    const input = queryScope(request);
    const actor = await readAccess(request, input, deps);
    const database = actor.ref.firestore;
    const prefix = `${scopeKey(input, actor.user.uid)}:`;
    const operations = await database.runTransaction(async tx => {
      await requireYouTubeUploadBusiness(tx, actor.ref, actor.user.uid, input.businessId);
      const result = await tx.get(database.collection(jobCollection).orderBy('listKey').startAt(prefix).endAt(`${prefix}\uf8ff`).limit(20));
      const now = clock(deps)();
      return result.docs.map(getJob).filter(job => isInHistory(job, now)).map(job => dto(job, now));
    });
    return { ok: true, operations, limits: { maxBytes: YOUTUBE_MAX_BYTES, chunkBytes: YOUTUBE_CHUNK_BYTES } };
  });
}

export function youtubeUploadGet(request: Request, rawId: string, deps: Dependencies = {}) {
  return respond(async () => {
    const id = operationId.parse(rawId);
    const input = queryScope(request);
    const actor = await readAccess(request, input, deps);
    const database = actor.ref.firestore;
    const ref = jobRef(database, jobKey(input, actor.user.uid, id));
    const job = await database.runTransaction(async tx => {
      await requireYouTubeUploadBusiness(tx, actor.ref, actor.user.uid, input.businessId);
      return getJob(await tx.get(ref));
    });
    if (!isInHistory(job, clock(deps)())) throw notFound();
    return { ok: true, operation: dto(job, clock(deps)()) };
  });
}

export function youtubeUploadCreate(request: Request, deps: Dependencies = {}) {
  return respond(async () => {
    const input = createInput.parse(await readJson(request, 32 * 1024));
    return admitYouTubeUpload(request, input, deps);
  });
}

/** Only this server-resolved production record can bypass browser file size/chunk admission. */
export function youtubeGeneratedUploadCreate(request: Request, productionId: string) {
  return respond(async () => {
    const { productionMediaAccess } = await import('./youtube-production-jobs');
    const { ref, job, context } = await productionMediaAccess.owned(request, productionId);
    const input = z.object({ thumbnailId: z.uuid().nullable().optional(), channelId: youtubeChannelId, connectionRevision: z.string().regex(/^[A-Za-z0-9_-]{43}$/), metadata, confirmed: z.literal(true) }).strict().parse(await readJson(request));
    if (job.state !== 'ready' || !job.sourceGeneration || !job.videoBytes || !job.durationSeconds) throw new ApiError(409, 'Tinjau video yang sudah selesai sebelum menerbitkan.');
    if ((input.thumbnailId ?? null) !== (job.thumbnails?.selected ?? null)) throw new ApiError(409, 'Pilihan thumbnail berubah. Muat ulang dan tinjau sebelum mengirim.');
    const { width, height } = (await import('../youtube-production')).productionResources(job.settings);
    return admitYouTubeUpload(request, { workspaceId: context.workspaceId, businessId: context.businessId,
      operationId: job.id, channelId: input.channelId, connectionRevision: input.connectionRevision,
      kind: job.settings.kind, file: { name: 'veloxa-video.mp4', size: job.videoBytes, mimeType: 'video/mp4', chunkHashes: [] }, metadata: input.metadata, confirmed: true }, {},
      { ...(input.thumbnailId ? { thumbnailId: input.thumbnailId } : {}), key: ref.id, generation: job.sourceGeneration, size: job.videoBytes, width, height, durationSeconds: job.durationSeconds }, ref);
  });
}

async function admitYouTubeUpload(request: Request, input: z.infer<typeof createInput>, deps: Dependencies, generatedSource?: GeneratedSource, productionRef?: Ref) {
    const actor = await readAccess(request, input, deps);
    const database = actor.ref.firestore;
    const ref = jobRef(database, jobKey(input, actor.user.uid, input.operationId));
    const fingerprint = digest(generatedSource ? { ...input, generatedSource } : input);
    const existing = await database.runTransaction(async tx => {
      await requireYouTubeUploadBusiness(tx, actor.ref, actor.user.uid, input.businessId);
      const doc = await tx.get(ref);
      return doc.exists ? sameOperation(getJob(doc), fingerprint) : null;
    });
    if (existing) {
      if (!isInHistory(existing, clock(deps)())) throw notFound();
      return { ok: true, operation: dto(existing, clock(deps)()) };
    }
    if ((deps.env ?? process.env).YOUTUBE_UPLOAD_STORAGE_RETENTION_READY !== 'true') {
      throw new ApiError(503, 'Unggah file belum diaktifkan. Hubungi admin workspace.', 'youtube_upload_storage_not_ready');
    }
    const { binding, config } = await (deps.uploadAccess ?? getYouTubeUploadAccess)(request, input.workspaceId, input.businessId);
    if (binding.ownerUid !== actor.user.uid || binding.channelId !== input.channelId || binding.connectionRevision !== input.connectionRevision) throw conflict();
    const job = await database.runTransaction(async tx => {
      await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, actor.ref, binding, config);
      const current = await tx.get(ref);
      if (current.exists) return sameOperation(getJob(current), fingerprint);
      if (productionRef && generatedSource) {
        const production = (await tx.get(productionRef)).data();
        if (!production || production.state !== 'ready' || production.sourceGeneration !== generatedSource.generation ||
            (production.thumbnails?.selected ?? null) !== (generatedSource.thumbnailId ?? null))
          throw new ApiError(409, 'Video atau thumbnail berubah. Muat ulang sebelum mengirim.');
      }
      const currentDispatch = (await tx.get(dispatchRef(actor.ref, input.businessId))).data();
      if (currentDispatch?.state === 'unknown') throw new ApiError(409, needsReview, 'youtube_upload_unresolved');
      if (currentDispatch) throw new ApiError(409, activeOther, 'youtube_upload_in_progress');
      const admission = admissionRef(actor.ref, input.businessId);
      const active = (await tx.get(admission)).data()?.jobId;
      if (typeof active === 'string' && /^[0-9a-f]{64}_[0-9a-f-]{36}$/.test(active)) {
        const pending = await tx.get(jobRef(database, active));
        if (pending.exists) {
          const saved = getJob(pending);
          if ((saved.binding.ownerUid === actor.user.uid && !isTerminal(saved.state)) || (saved.finalIntent && !saved.video)) {
            throw new ApiError(409, activeOther, 'youtube_upload_in_progress');
          }
        }
      }
      const saved = (await tx.get(actor.ref.collection('private_youtube_connections').doc(input.businessId))).data();
      const channelTitle = z.string().min(1).max(200).safeParse(saved?.title);
      if (!channelTitle.success) throw conflict();
      const now = clock(deps)();
      const job: Job = {
        id: input.operationId, binding, channelTitle: channelTitle.data, fingerprint,
        mediaNamespace: scopeKey(input, actor.user.uid) + '_' + randomUUID(),
        listKey: `${scopeKey(input, actor.user.uid)}:${String(9_999_999_999_999 - now).padStart(13, '0')}:${input.operationId}`,
        kind: input.kind, file: input.file, metadata: input.metadata, state: generatedSource ? 'validating' : 'receiving',
        ...(generatedSource ? { generatedSource } : {}),
        chunks: {}, sourceGeneration: null, measured: null, video: null, youtubeBytes: 0,
        encryptedSession: null, finalIntent: false, attempts: 0, sessionRestarts: 0,
        revision: 1, createdAt: now, updatedAt: now, expiresAt: now + day, historyUntil: now + historyTime,
        nextRunAt: generatedSource ? now : now + day, message: null, retryAt: null, mediaCleaned: false,
        mediaWritePending: null, mediaWriteUncertain: false, mediaCleanupRecheckAt: null, lease: null,
      };
      if (productionRef) tx.update(productionRef, { thumbnailSubmitted: true });
      tx.create(ref, job);
      tx.set(admission, { jobId: ref.id, ownerUid: actor.user.uid });
      return job;
    });
    return { ok: true, operation: dto(job, clock(deps)()) };
}

async function stageChunk(request: Request, rawId: string, deps: Dependencies) {
  const id = operationId.parse(rawId);
  const input = queryScope(request);
  const indices = new URL(request.url).searchParams.getAll('index');
  const index = chunkIndex.parse(indices.length === 1 ? indices[0] : null);
  const actor = await readAccess(request, input, deps);
  const database = actor.ref.firestore;
  const ref = jobRef(database, jobKey(input, actor.user.uid, id));
  const job = await database.runTransaction(async tx => {
    await requireYouTubeUploadBusiness(tx, actor.ref, actor.user.uid, input.businessId);
    return getJob(await tx.get(ref));
  });
  const expectedHash = job.file.chunkHashes[index];
  if (!expectedHash) throw new ApiError(400, 'Bagian ini tidak tercantum dalam file yang ditinjau.');
  const now = clock(deps);
  requireSourceAvailable(job, now());
  const size = uploadChunkSize(job.file.size, index);
  if (job.chunks[String(index)]) {
    await readUploadChunk(request, size, expectedHash);
    return dto(job, now());
  }
  if (job.state !== 'receiving') throw conflict();
  const config = (deps.config ?? youtubeConfigForWorkspace)(input.workspaceId);
  if (!config) throw new ApiError(409, needsPermission, 'reconnect_required');
  const leaseId = randomUUID();
  const claimed = await database.runTransaction(async tx => {
    const current = getJob(await tx.get(ref));
    await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, actor.ref, current.binding, config);
    if (current.chunks[String(index)]) return current;
    if (current.state !== 'receiving' || current.lease && current.lease.until > now()) throw conflict();
    requireSourceAvailable(current, now());
    tx.update(ref, { lease: { id: leaseId, until: now() + leaseTime } });
    return null;
  });
  if (claimed) {
    await readUploadChunk(request, size, expectedHash);
    return dto(claimed, now());
  }
  try {
    const bytes = await readUploadChunk(request, size, expectedHash);
    const renewed = await database.runTransaction(async tx => {
      const current = getJob(await tx.get(ref));
      await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, actor.ref, current.binding, config);
      const checkedAt = now();
      requireLease(current, leaseId, checkedAt);
      requireSourceAvailable(current, checkedAt);
      if (current.state !== 'receiving' || current.chunks[String(index)]) throw conflict();
      const lease = { id: leaseId, until: checkedAt + leaseTime };
      // Persist the obligation before GCS can accept bytes, even if this invocation disappears.
      const mediaWrite = { mediaWritePending: leaseId, mediaWriteUncertain: Boolean(current.mediaWriteUncertain || current.mediaWritePending) };
      tx.update(ref, { lease, ...mediaWrite });
      return { ...current, lease, ...mediaWrite };
    });
    const generation = await media(deps).stage(mediaKey(renewed, ref), index, expectedHash, bytes, sourceSignal(renewed, leaseId, now, request.signal));
    const saved = await database.runTransaction(async tx => {
      const current = getJob(await tx.get(ref));
      await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, actor.ref, current.binding, config);
      requireLease(current, leaseId, now());
      if (current.mediaWritePending !== leaseId) throw conflict();
      const chunks = { ...current.chunks, [String(index)]: generation };
      const complete = Object.keys(chunks).length === current.file.chunkHashes.length;
      return update(tx, ref, current, {
        chunks, state: complete ? 'validating' : 'receiving', mediaWritePending: null,
        lease: null, nextRunAt: complete ? now() : current.expiresAt,
      }, now());
    });
    return dto(saved, now());
  } finally {
    await releaseLease(ref, leaseId).catch(() => {});
  }
}

export function youtubeUploadChunk(request: Request, rawId: string, deps: Dependencies = {}) {
  return respond(async () => ({ ok: true, operation: await stageChunk(request, rawId, deps) }));
}

function requireLease(job: Job, leaseId: string, now: number) {
  if (job.lease?.id !== leaseId || job.lease.until <= now) throw conflict();
}

function requireSourceAvailable(job: Job, now: number) {
  if (job.mediaCleaned || mediaDeadline(job) <= now) throw new ApiError(409, expiredMessage, sourceExpiredCode);
}

function requireSourceLease(job: Job, leaseId: string, now: number) {
  requireLease(job, leaseId, now);
  requireSourceAvailable(job, now);
}

function sourceSignal(job: Job, leaseId: string, now: () => number, parent: UploadWorkSignal): UploadWorkSignal {
  assertWorkActive(parent);
  const checkedAt = now();
  requireSourceLease(job, leaseId, checkedAt);
  const duration = Math.min(mediaDeadline(job), job.lease!.until) - checkedAt;
  return Object.assign(AbortSignal.any([parent, AbortSignal.timeout(duration)]), {
    assertActive: () => {
      requireSourceLease(job, leaseId, now());
      assertWorkActive(parent);
    },
  });
}

async function releaseLease(ref: Ref, leaseId: string, nextRunAt?: number) {
  await ref.firestore.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.lease?.id === leaseId) tx.update(ref, {
      lease: null, ...(nextRunAt === undefined ? {} : { nextRunAt }),
    });
  });
}

type WorkMode = 'run' | 'check' | 'cleanup' | 'expire' | 'retain' | 'purge';
type GuardUpdate = 'leave' | 'clear' | 'unknown';

function workMode(job: Job, now: number, manualCheck: boolean): WorkMode | null {
  const terminal = isTerminal(job.state);
  if (hasUnresolvedFinal(job) && !job.reconciliationOnly && job.mediaCleaned && job.historyUntil <= now) return 'retain';
  if (job.mediaCleanupRecheckAt && cleanupEligible(job, now) && job.nextRunAt <= now) return 'cleanup';
  if ((job.video || terminal && hasUnresolvedFinal(job)) && cleanupEligible(job, now) && mediaDeadline(job) <= now) {
    const deferredByReview = hasUnresolvedFinal(job) && job.nextRunAt === job.retryAt;
    return job.nextRunAt <= now || deferredByReview ? 'cleanup' : null;
  }
  if (manualCheck) {
    const knownVideo = job.video && job.historyUntil > now;
    const reviewable = job.state === 'needs_review' && (knownVideo || hasUnresolvedFinal(job) && job.encryptedSession);
    const processing = !terminal && knownVideo && job.nextRunAt <= now && workDeadline(job) > now;
    if ((reviewable || processing) && (job.retryAt ?? 0) <= now) return 'check';
    return terminal && cleanupEligible(job, now) && job.nextRunAt <= now ? 'cleanup' : null;
  }
  if (job.nextRunAt > now) return null;
  if (terminal) {
    if (cleanupEligible(job, now)) return 'cleanup';
    if (hasUnresolvedFinal(job)) return job.reconciliationOnly ? null : 'retain';
    return job.historyUntil <= now ? 'purge' : null;
  }
  if (workDeadline(job) <= now) return 'expire';
  return job.state === 'receiving' ? null : 'run';
}

async function claimWork(ref: Ref, manualCheck: boolean, now: () => number) {
  const leaseId = randomUUID();
  return ref.firestore.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return null;
    const job = getJob(snapshot);
    const mode = workMode(job, now(), manualCheck);
    if (!mode || job.lease && job.lease.until > now()) return null;
    const lease = { id: leaseId, until: now() + leaseTime };
    const claimed = { ...job, lease, nextRunAt: lease.until };
    tx.update(ref, { lease, nextRunAt: lease.until });
    return { job: claimed, mode, leaseId, previousNextRunAt: job.nextRunAt };
  });
}

async function commitWork(ref: Ref, leaseId: string, patch: Partial<Job>, now: () => number, guardUpdate: GuardUpdate = 'leave', mediaWriteId?: string) {
  return ref.firestore.runTransaction(async tx => {
    const job = getJob(await tx.get(ref));
    requireLease(job, leaseId, now());
    if (mediaWriteId !== undefined && job.mediaWritePending !== mediaWriteId) throw conflict();
    if (guardUpdate !== 'leave') {
      const workspace = workspaceRef(job, ref);
      const guard = dispatchRef(workspace, job.binding.businessId);
      const current = (await tx.get(guard)).data();
      if (current?.jobId === ref.id) {
        if (guardUpdate === 'clear') tx.delete(guard);
        else tx.set(guard, { jobId: ref.id, state: 'unknown' });
      }
    }
    return update(tx, ref, job, patch, now());
  });
}

function finished(job: Job, state: Job['state'], now: number, message: string | null): Partial<Job> {
  const ambiguous = state === 'needs_review' && job.finalIntent && !job.video;
  return {
    state, message, lease: null, retryAt: state === 'needs_review' ? now + 10_000 : null,
    nextRunAt: job.mediaCleaned ? (ambiguous ? reviewRetentionDue(job) : job.historyUntil)
      : job.mediaCleanupRecheckAt ?? (ambiguous && job.sourceGeneration ? mediaDeadline(job) : nextWithMediaCleanup(job, now + 10_000)),
    encryptedSession: ambiguous ? job.encryptedSession : null,
  };
}

async function expireWork(ref: Ref, job: Job, leaseId: string, now: () => number) {
  const ambiguous = job.finalIntent && !job.video;
  const state = ambiguous || job.video ? 'needs_review' : 'cancelled';
  const patch = finished(job, state, now(), state === 'needs_review' ? needsReview : expiredMessage);
  if (ambiguous) patch.retryAt = Math.max(job.retryAt ?? 0, patch.retryAt ?? 0);
  await commitWork(ref, leaseId, patch, now, ambiguous ? 'unknown' : 'clear');
}

async function probeLock(ref: Ref, job: Job, leaseId: string, config: YouTubeConfig, deps: Dependencies) {
  const lock = probeRef(ref.firestore);
  const now = clock(deps);
  const acquired = await ref.firestore.runTransaction(async tx => {
    const current = getJob(await tx.get(ref));
    requireLease(current, leaseId, now());
    await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, workspaceRef(job, ref), job.binding, config);
    const lease = (await tx.get(lock)).data();
    const checkedAt = now();
    requireLease(current, leaseId, checkedAt);
    requireSourceAvailable(current, checkedAt);
    if (lease?.until > checkedAt) return false;
    tx.set(lock, { id: leaseId, until: current.lease!.until });
    return true;
  });
  return acquired ? lock : null;
}

async function validateSource(ref: Ref, job: Job, leaseId: string, signal: UploadWorkSignal, deps: Dependencies) {
  const now = clock(deps);
  const config = (deps.config ?? youtubeConfigForWorkspace)(job.binding.workspaceId);
  if (!config) throw new YouTubeUploadFailure('permission');
  const lock = await probeLock(ref, job, leaseId, config, deps);
  if (!lock) {
    await commitWork(ref, leaseId, { lease: null, nextRunAt: now() + 3000 }, now);
    return;
  }
  try {
    if (job.generatedSource) {
      const source = job.generatedSource;
      if (!/^[0-9a-f]{64}_[0-9a-f-]{36}$/.test(source.key) || !/^[1-9]\d{0,19}$/.test(source.generation)) throw new YouTubeUploadFailure('retry');
      const writing = await commitWork(ref, leaseId, { mediaWritePending: leaseId, mediaWriteUncertain: true }, now);
      const target = adminBucket().file(`private-youtube-uploads/${mediaKey(writing, ref)}/source`);
      const original = adminBucket().file(`private-youtube-productions/${source.key}/final.mp4`, { generation: source.generation });
      const signalForSource = sourceSignal(writing, leaseId, now, signal);
      const [originalMetadata] = await withinUploadDeadline(() => original.getMetadata(), signalForSource);
      try {
        await withinUploadDeadline(() => original.copy(target, { preconditionOpts: { ifGenerationMatch: 0 } }), signalForSource);
      } catch (error) { if ((error as { code?: number }).code !== 412) throw error; }
      const [copied] = await withinUploadDeadline(() => target.getMetadata(), signalForSource);
      if (Number(copied.size) !== source.size || !originalMetadata.crc32c || copied.crc32c !== originalMetadata.crc32c) throw new YouTubeUploadFailure('retry');
      await commitWork(ref, leaseId, { sourceGeneration: String(copied.generation), measured: {
        durationSeconds: source.durationSeconds, width: source.width, height: source.height,
        shortsEligible: source.height >= source.width && source.durationSeconds <= 180,
      }, state: 'queued', nextRunAt: now(), attempts: 0, retryAt: null, lease: null, mediaWritePending: null }, now);
      return;
    }
    const generations = job.file.chunkHashes.map((_, index) => job.chunks[String(index)]);
    const writing = job.sourceGeneration ? job : await commitWork(ref, leaseId, {
      mediaWritePending: leaseId, mediaWriteUncertain: Boolean(job.mediaWriteUncertain || job.mediaWritePending),
    }, now);
    const sourceGeneration = job.sourceGeneration ?? await media(deps).compose(
      mediaKey(writing, ref), job.file, generations, sourceSignal(writing, leaseId, now, signal),
    );
    const composed = job.sourceGeneration ? job : await commitWork(ref, leaseId, { sourceGeneration, mediaWritePending: null }, now, 'leave', leaseId);
    const measured = await media(deps).measure(
      mediaKey(composed, ref), job.file, sourceGeneration, sourceSignal(composed, leaseId, now, signal),
    );
    await ref.firestore.runTransaction(async tx => {
      const current = getJob(await tx.get(ref));
      requireLease(current, leaseId, now());
      await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, workspaceRef(job, ref), job.binding, config);
      const patch: Partial<Job> = { sourceGeneration, measured, attempts: 0, retryAt: null, lease: null };
      if (job.kind === 'short' && !measured.shortsEligible) {
        Object.assign(patch, finished(current, 'rejected', now(), measured.durationIsLowerBound
          ? 'Durasi akhir video belum dapat dipastikan. Ekspor ulang video dengan metadata durasi lengkap untuk Shorts.'
          : 'Shorts harus berbentuk persegi atau vertikal dengan durasi hingga 3 menit.'));
      } else {
        Object.assign(patch, {
          state: 'queued', nextRunAt: now(),
          message: job.kind === 'video' && measured.shortsEligible ? 'YouTube dapat mengategorikan video ini sebagai Shorts.' : null,
        });
      }
      update(tx, ref, current, patch, now());
    });
  } finally {
    await ref.firestore.runTransaction(async tx => {
      const current = (await tx.get(lock)).data();
      if (current?.id === leaseId) tx.delete(lock);
    }).catch(() => {});
  }
}

async function fenceDispatch(ref: Ref, leaseId: string, config: YouTubeConfig, phase: 'status' | 'source' | 'final', deps: Dependencies) {
  const now = clock(deps);
  return ref.firestore.runTransaction(async tx => {
    const job = getJob(await tx.get(ref));
    requireLease(job, leaseId, now());
    const workspace = workspaceRef(job, ref);
    await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, workspace, job.binding, config);
    const guard = dispatchRef(workspace, job.binding.businessId);
    const stored = (await tx.get(guard)).data();
    if (stored && stored.jobId !== ref.id) throw new ApiError(409, activeOther, 'youtube_upload_in_progress');
    if (!stored && job.encryptedSession) throw new YouTubeUploadFailure('permission');
    const checkedAt = now();
    requireLease(job, leaseId, checkedAt);
    if (phase !== 'status') requireSourceAvailable(job, checkedAt);
    if (!stored) tx.create(guard, { jobId: ref.id, state: 'active' });
    if (phase === 'final' && !job.finalIntent) return update(tx, ref, job, { finalIntent: true }, checkedAt);
    return job;
  });
}

function contextKey(ref: Ref, job: Job) {
  return JSON.stringify(['youtube-upload-session-v1', ref.id, job.binding.workspaceId, job.binding.businessId,
    job.binding.ownerUid, job.binding.channelId, job.binding.connectionRevision, job.binding.grantId]);
}

function videoDto(item: ProviderVideo): NonNullable<Job['video']> {
  return {
    id: item.id, url: `https://www.youtube.com/watch?v=${item.id}`,
    privacy: item.status.privacyStatus, processingStatus: item.processingDetails?.processingStatus ?? item.status.uploadStatus ?? 'uploaded',
  };
}

async function saveVideo(ref: Ref, job: Job, leaseId: string, video: ProviderVideo, now: () => number) {
  if (video.snippet.channelId !== job.binding.channelId) {
    await commitWork(ref, leaseId, finished(job, 'needs_review', now(), needsReview), now, 'unknown');
    return;
  }
  const receivedAt = now();
  await commitWork(ref, leaseId, {
    state: 'processing', video: videoDto(video), youtubeBytes: job.file.size, encryptedSession: null, attempts: 0,
    processingUntil: receivedAt + day,
    historyUntil: Math.max(job.historyUntil, receivedAt + historyTime),
    message: null, lease: null, retryAt: null, nextRunAt: nextWithMediaCleanup(job, receivedAt + 10_000),
  }, now, 'clear');
}

async function saveVideoStatus(ref: Ref, job: Job, leaseId: string, item: ProviderVideo | null, now: () => number) {
  if (!item) throw new YouTubeUploadFailure('retry');
  if (item.id !== job.video!.id || item.snippet.channelId !== job.binding.channelId) {
    await commitWork(ref, leaseId, finished(job, 'needs_review', now(), 'Video tidak dapat dipastikan pada channel bisnis ini.'), now);
    return;
  }
  const video = videoDto(item);
  const status = item.status.uploadStatus;
  const processing = item.processingDetails?.processingStatus;
  const failed = status === 'failed' || status === 'rejected' || status === 'deleted' || processing === 'failed';
  const processed = status === 'processed' || processing === 'succeeded';
  if (failed || processed || processing === 'terminated') {
    const privacyMatches = video.privacy === job.metadata.privacy;
    const state = failed ? 'rejected' : processed && privacyMatches ? 'ready' : 'needs_review';
    const message = failed ? 'YouTube melaporkan video ditolak, dihapus, atau gagal diproses.'
      : !privacyMatches ? 'Visibilitas di YouTube berbeda dari pilihan Anda. Periksa video di YouTube Studio.'
      : !processed ? 'YouTube tidak lagi memberi status pemrosesan. Periksa video di YouTube Studio.' : null;
    await commitWork(ref, leaseId, { ...finished(job, state, now(), message), video }, now);
    return;
  }
  await commitWork(ref, leaseId, {
    video, state: 'processing', attempts: 0, retryAt: null, lease: null, message: null, nextRunAt: nextWithMediaCleanup(job, now() + minute),
  }, now);
}

type UploadCredentials = Awaited<ReturnType<typeof loadYouTubeUploadCredentials>>;

function isUnauthorized(error: unknown) {
  return error instanceof YouTubeUploadFailure && error.kind === 'unauthenticated';
}

async function checkStatusWithRefresh<T>(
  initial: UploadCredentials & { binding: YouTubeUploadBinding },
  renew: (rejected: string) => Promise<UploadCredentials>,
  check: (credentials: UploadCredentials) => Promise<T>,
  signal: UploadWorkSignal,
  deps: Dependencies,
): Promise<T> {
  try {
    return await check(initial);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }

  const renewed = await renew(initial.accessToken);
  try {
    return await check(renewed);
  } catch (error) {
    if (isUnauthorized(error)) {
      await withinUploadDeadline(() => (deps.invalidateCredentials ?? invalidateYouTubeUploadAccessToken)(
        initial.binding, renewed.accessToken,
      ), signal);
    }
    throw error;
  }
}

async function checkFinalSession(ref: Ref, job: Job, leaseId: string, signal: UploadWorkSignal, deps: Dependencies) {
  const now = clock(deps);
  const workspace = workspaceRef(job, ref);
  const readFence = async (tx: Tx) => {
    const current = getJob(await tx.get(ref));
    requireLease(current, leaseId, now());
    const guard = (await tx.get(dispatchRef(workspace, job.binding.businessId))).data();
    if (current.state !== 'needs_review' || !hasUnresolvedFinal(current) || !current.encryptedSession ||
      current.encryptedSession !== job.encryptedSession || guard?.jobId !== ref.id || guard.state !== 'unknown') throw conflict();
  };
  const fresh = await ref.firestore.runTransaction(async tx => {
    await readFence(tx);
    const config = (deps.config ?? youtubeConfigForWorkspace)(job.binding.workspaceId);
    if (!config) throw new YouTubeUploadFailure('permission');
    return (deps.reviewCredentials ?? readYouTubeUploadReviewCredentials)(tx, workspace, job.binding, config, now);
  });
  const loadApproved = async (rejected?: string) => {
    const credentials = await withinUploadDeadline(
      () => (deps.credentials ?? loadYouTubeUploadCredentials)(job.binding, undefined, rejected, signal), signal,
    );
    await ref.firestore.runTransaction(async tx => {
      await readFence(tx);
      await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, workspace, job.binding, credentials.config);
    });
    return credentials;
  };
  const provider = deps.provider ?? youtubeUploadProvider();
  const check = ({ accessToken, config }: UploadCredentials) => {
    requireLease(job, leaseId, now());
    assertWorkActive(signal);
    const session = openYouTubeSession(job.encryptedSession!, contextKey(ref, job), config.encryptionKey);
    // Pemeriksaan hanya menanyakan sesi yang sama, tanpa isi video dan tanpa membuat sesi baru.
    return provider.transfer(accessToken, session, job.file.size, signal);
  };
  const result = fresh ? await check(fresh) : await checkStatusWithRefresh(
    { ...await loadApproved(), binding: job.binding }, loadApproved, check, signal, deps,
  );
  if (result.kind === 'complete') {
    await saveVideo(ref, job, leaseId, result.video, now);
    return;
  }
  if (!fresh && job.sourceGeneration && !job.mediaCleaned && mediaDeadline(job) > now() && result.offset >= job.youtubeBytes) {
    await commitWork(ref, leaseId, {
      state: 'uploading', youtubeBytes: result.offset, attempts: 0, retryAt: null, lease: null,
      message: null, nextRunAt: now(),
    }, now);
    return;
  }
  await commitWork(ref, leaseId, finished(job, 'needs_review', now(), needsReview), now, 'unknown');
}

async function checkKnownVideo(ref: Ref, job: Job, leaseId: string, signal: UploadWorkSignal, deps: Dependencies) {
  const now = clock(deps);
  const workspace = workspaceRef(job, ref);
  const readLease = async (tx: Tx) => {
    const current = getJob(await tx.get(ref));
    requireLease(current, leaseId, now());
    if (current.video?.id !== job.video?.id) throw conflict();
  };
  const loadAndVerify = async (binding: YouTubeUploadBinding, rejected?: string) => {
    const result = await withinUploadDeadline(
      () => (deps.credentials ?? loadYouTubeUploadCredentials)(binding, undefined, rejected, signal), signal,
    );
    await ref.firestore.runTransaction(async tx => {
      await readLease(tx);
      await (deps.assertBinding ?? assertYouTubeUploadBinding)(tx, workspace, binding, result.config);
    });
    return result;
  };

  let binding = job.binding;
  let credentials: UploadCredentials;
  try {
    credentials = await loadAndVerify(binding);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'needs_permission') throw error;
    binding = await ref.firestore.runTransaction(async tx => {
      await readLease(tx);
      const config = (deps.config ?? youtubeConfigForWorkspace)(job.binding.workspaceId);
      if (!config) throw new YouTubeUploadFailure('permission');
      return readYouTubeVideoStatusBinding(tx, workspace, job.binding, config);
    });
    credentials = await loadAndVerify(binding);
  }
  const provider = deps.provider ?? youtubeUploadProvider();
  const video = await checkStatusWithRefresh(
    { ...credentials, binding },
    rejected => loadAndVerify(binding, rejected),
    ({ accessToken }) => {
      requireLease(job, leaseId, now());
      assertWorkActive(signal);
      return provider.video(accessToken, job.video!.id, signal);
    },
    signal,
    deps,
  );
  const source = job.generatedSource;
  const processed = video?.status.uploadStatus === 'processed' || video?.processingDetails?.processingStatus === 'succeeded';
  if (source?.thumbnailId && processed && video?.id === job.video?.id && video?.snippet.channelId === job.binding.channelId &&
      !['failed', 'rejected', 'deleted'].includes(video.status.uploadStatus ?? '') && video.processingDetails?.processingStatus !== 'failed') {
    try {
      if (binding !== job.binding) throw new YouTubeUploadFailure('permission');
      const [image] = await adminBucket().file(`private-youtube-productions/${source.key}/thumb-${z.uuid().parse(source.thumbnailId)}.jpg`).download();
      const granted = await loadAndVerify(job.binding);
      await provider.setThumbnail(granted.accessToken, video.id, image, signal);
    } catch (error) {
      if (error instanceof YouTubeUploadFailure && error.kind === 'retry' && job.attempts < maxTries) {
        const next = now() + Math.min(15 * minute, minute * (job.attempts + 1));
        await commitWork(ref, leaseId, { state: 'processing', attempts: job.attempts + 1, lease: null,
          retryAt: next, nextRunAt: next, message: 'Video sudah diterima. Pemasangan thumbnail akan dicoba kembali.' }, now);
        return;
      }
      await commitWork(ref, leaseId, finished(job, 'needs_review', now(), 'Video sudah diterima YouTube. Thumbnail belum terpasang. Periksa izin thumbnail channel lalu coba periksa pengiriman ini lagi.'), now);
      return;
    }
  }
  await saveVideoStatus(ref, job, leaseId, video, now);
}

async function sendUploadStep(
  ref: Ref,
  leaseId: string,
  credentials: UploadCredentials,
  signal: UploadWorkSignal,
  deps: Dependencies,
  renew: (rejected: string) => Promise<UploadCredentials>,
) {
  const { accessToken, config } = credentials;
  const now = clock(deps);
  assertWorkActive(signal);
  const provider = deps.provider ?? youtubeUploadProvider();
  let job = await fenceDispatch(ref, leaseId, config, 'status', deps);
  assertWorkActive(signal);
  if (!job.encryptedSession) {
    if (job.finalIntent) throw new YouTubeUploadFailure('expired');
    await (deps.singleChannel ?? assertSingleYouTubeUploadChannel)(accessToken, job.binding.channelId, { signal });
    job = await fenceDispatch(ref, leaseId, config, 'source', deps);
    requireSourceLease(job, leaseId, now());
    assertWorkActive(signal);
    const session = await provider.start(accessToken, job.metadata, job.file, signal, () => requireSourceLease(job, leaseId, now()));
    await commitWork(ref, leaseId, {
      state: 'uploading', encryptedSession: sealYouTubeSession(session, contextKey(ref, job), config.encryptionKey),
      attempts: 0, retryAt: null, message: null, lease: null, nextRunAt: now(),
    }, now);
    return;
  }
  const encryptedSession = job.encryptedSession;
  const readStatus = async (used: UploadCredentials) => {
    requireLease(job, leaseId, now());
    assertWorkActive(signal);
    const session = openYouTubeSession(encryptedSession, contextKey(ref, job), used.config.encryptionKey);
    const result = await provider.transfer(used.accessToken, session, job.file.size, signal);
    return { result, session, credentials: used };
  };
  const status = job.finalIntent ? await checkStatusWithRefresh(
    { ...credentials, binding: job.binding },
    async rejected => {
      const renewed = await renew(rejected);
      const current = await fenceDispatch(ref, leaseId, renewed.config, 'status', deps);
      if (!current.finalIntent || current.video || current.encryptedSession !== encryptedSession) throw conflict();
      return renewed;
    },
    readStatus,
    signal,
    deps,
  ) : await readStatus(credentials);
  const { result, session, credentials: sessionCredentials } = status;
  if (result.kind === 'complete') {
    await saveVideo(ref, job, leaseId, result.video, now);
    return;
  }
  // Acknowledged progress can resume only the existing session, including a partial final PUT.
  if (result.offset < job.youtubeBytes || !job.sourceGeneration) throw new YouTubeUploadFailure('retry');
  if (result.offset > job.youtubeBytes) job = await commitWork(ref, leaseId, { youtubeBytes: result.offset }, now);
  const total = job.file.size;
  const start = result.offset;
  const end = Math.min(total, start + YOUTUBE_CHUNK_BYTES) - 1;
  job = await fenceDispatch(ref, leaseId, sessionCredentials.config, 'source', deps);
  const bytes = await media(deps).read(
    mediaKey(job, ref), job.sourceGeneration!, start, end, total, sourceSignal(job, leaseId, now, signal),
  );
  const previousFinalIntent = job.finalIntent;
  job = await fenceDispatch(ref, leaseId, sessionCredentials.config, end + 1 === total ? 'final' : 'source', deps);
  const assertSource = () => requireSourceLease(job, leaseId, now());
  let providerCalled = false;
  let sent: ProviderTransfer;
  try {
    assertSource();
    assertWorkActive(signal);
    providerCalled = true;
    sent = await provider.transfer(sessionCredentials.accessToken, session, total, signal, { start, bytes }, assertSource);
  } catch (error) {
    const unsent = !providerCalled || error instanceof YouTubeRequestNotSent;
    if (!previousFinalIntent && job.finalIntent && unsent) {
      await commitWork(ref, leaseId, { finalIntent: false }, now).catch(() => {});
    }
    throw error;
  }
  if (sent.kind === 'complete') {
    await saveVideo(ref, job, leaseId, sent.video, now);
    return;
  }
  if (sent.offset <= start) throw new YouTubeUploadFailure('retry');
  await commitWork(ref, leaseId, {
    state: 'uploading', youtubeBytes: sent.offset, attempts: 0, retryAt: null, message: null, lease: null, nextRunAt: now(),
  }, now);
}

async function uploadToYouTube(ref: Ref, initial: Job, mode: WorkMode, leaseId: string, signal: UploadWorkSignal, deps: Dependencies) {
  if (initial.video) return checkKnownVideo(ref, initial, leaseId, signal, deps);
  if (mode === 'check') return checkFinalSession(ref, initial, leaseId, signal, deps);
  const load = (rejected?: string) => withinUploadDeadline(
    () => (deps.credentials ?? loadYouTubeUploadCredentials)(initial.binding, undefined, rejected, signal), signal,
  );
  const requirePreFinal = async (error: unknown) => {
    const tokenRejected = error instanceof YouTubeUploadTokenRejected || isUnauthorized(error);
    if (!tokenRejected) throw error;
    const job = getJob(await ref.get());
    requireLease(job, leaseId, clock(deps)());
    if (job.finalIntent || job.video) throw error;
  };
  const send = (credentials: UploadCredentials) => sendUploadStep(ref, leaseId, credentials, signal, deps, load);
  const initialCredentials = await load();
  // Setelah final intent, hanya pemeriksaan sesi yang boleh mengulang permintaan 401.
  if (initial.finalIntent) return send(initialCredentials);
  try {
    await send(initialCredentials);
  } catch (error) {
    await requirePreFinal(error);
    const renewed = await load(initialCredentials.accessToken);
    try {
      await send(renewed);
    } catch (failure) {
      await requirePreFinal(failure);
      const invalidated = await withinUploadDeadline(() => (deps.invalidateCredentials ?? invalidateYouTubeUploadAccessToken)(
        initial.binding, renewed.accessToken,
      ), signal);
      throw new YouTubeUploadFailure(invalidated ? 'permission' : 'retry');
    }
  }
}

function retryDelay(attempt: number) {
  return Math.min(15 * minute, 15_000 * 2 ** Math.min(attempt - 1, 6));
}

async function workerFailure(ref: Ref, leaseId: string, mode: WorkMode, error: unknown, now: () => number) {
  const job = getJob(await ref.get());
  requireLease(job, leaseId, now());
  const attempts = job.attempts + 1;
  const ambiguous = job.finalIntent && !job.video;
  const apiCode = error instanceof ApiError ? error.code : '';
  const failure = error instanceof YouTubeUploadFailure ? error.kind : null;
  const lostPermission = failure === 'permission' || failure === 'unauthenticated' || ['forbidden', 'reconnect_required', 'youtube_not_configured', 'business_context_invalid',
    'needs_permission', 'youtube_upload_permission_required', 'youtube_channel_not_authorized', 'youtube_channel_mismatch'].includes(apiCode);
  if (mode === 'cleanup') {
    const mediaCleanupAttempts = (job.mediaCleanupAttempts ?? 0) + 1;
    const mediaCleanupRecheckAt = now() + retryDelay(mediaCleanupAttempts);
    const cleanupJob = { ...job, mediaCleanupRecheckAt };
    await commitWork(ref, leaseId, { mediaCleanupAttempts, mediaCleanupRecheckAt, lease: null,
      nextRunAt: nextAfterCleanup(cleanupJob, now()),
    }, now);
    return;
  }
  if (mode === 'retain' || mode === 'purge') {
    await commitWork(ref, leaseId, { lease: null, nextRunAt: now() + retryDelay((job.mediaCleanupAttempts ?? 0) + 1) }, now);
    return;
  }
  if (apiCode === sourceExpiredCode) {
    await expireWork(ref, job, leaseId, now);
    return;
  }
  if (mode === 'check' || ambiguous && (lostPermission || failure === 'expired' || failure === 'rejected' || attempts >= maxTries)) {
    await commitWork(ref, leaseId, finished(job, 'needs_review', now(), needsReview), now, ambiguous ? 'unknown' : 'leave');
    return;
  }
  if (lostPermission) {
    const state = job.video ? 'needs_review' : 'needs_permission';
    await commitWork(ref, leaseId, finished(job, state, now(), needsPermission), now, 'clear');
    return;
  }
  if (failure === 'expired' && !ambiguous && job.sessionRestarts < 2) {
    const retryAt = now() + retryDelay(attempts);
    await commitWork(ref, leaseId, {
      encryptedSession: null, youtubeBytes: 0, sessionRestarts: job.sessionRestarts + 1,
      attempts, retryAt, state: 'retry_wait',
      message: 'Sesi pengiriman kedaluwarsa. Veloxa akan melanjutkan pekerjaan yang sama.',
      lease: null, nextRunAt: nextWithMediaCleanup(job, retryAt),
    }, now, 'clear');
    return;
  }
  const rejected = failure === 'rejected' || failure === 'expired' || apiCode === 'youtube_invalid_video';
  if (!ambiguous && (rejected || attempts >= maxTries || workDeadline(job) <= now())) {
    const message = apiCode === 'youtube_invalid_video' && error instanceof ApiError ? error.message
      : rejected ? 'YouTube tidak menerima unggahan ini. Periksa file, informasi video, dan batas unggahan channel.'
      : 'Layanan belum dapat menyelesaikan unggahan setelah beberapa percobaan.';
    await commitWork(ref, leaseId, finished(job, job.video ? 'needs_review' : 'rejected', now(), message), now, 'clear');
    return;
  }
  const retryAt = now() + retryDelay(attempts);
  await commitWork(ref, leaseId, {
    state: 'retry_wait', attempts, retryAt, lease: null, nextRunAt: nextWithMediaCleanup(job, retryAt),
    message: ambiguous ? 'Veloxa sedang memeriksa hasil pengiriman yang sama.' : 'Layanan sementara terputus. Veloxa akan mencoba pekerjaan ini kembali.',
  }, now);
}

async function purgeWork(ref: Ref, job: Job, leaseId: string, now: () => number) {
  await ref.firestore.runTransaction(async tx => {
    const current = getJob(await tx.get(ref));
    requireLease(current, leaseId, now());
    const admission = admissionRef(workspaceRef(job, ref), job.binding.businessId);
    const held = (await tx.get(admission)).data();
    if (held?.jobId === ref.id) tx.delete(admission);
    tx.delete(ref);
  });
}

async function retainReconciliation(ref: Ref, job: Job, leaseId: string, now: () => number) {
  if (!hasUnresolvedFinal(job) || !job.mediaCleaned || job.historyUntil > now()) {
    await commitWork(ref, leaseId, { lease: null, nextRunAt: nextWithMediaCleanup(job, reviewRetentionDue(job)) }, now);
    return;
  }
  await ref.firestore.runTransaction(async tx => {
    const current = getJob(await tx.get(ref));
    requireLease(current, leaseId, now());
    if (!hasUnresolvedFinal(current) || !current.mediaCleaned || current.historyUntil > now()) throw conflict();
    tx.set(ref, {
      id: current.id, binding: current.binding, fingerprint: current.fingerprint, listKey: current.listKey,
      kind: current.kind, reconciliationOnly: true, totalBytes: current.file.size, expectedPrivacy: current.metadata.privacy,
      state: 'needs_review', encryptedSession: current.encryptedSession, finalIntent: true, video: null,
      youtubeBytes: current.youtubeBytes, attempts: current.attempts, sessionRestarts: current.sessionRestarts,
      revision: current.revision + 1, createdAt: current.createdAt, updatedAt: now(), expiresAt: current.expiresAt,
      historyUntil: current.historyUntil, retryAt: current.retryAt, nextRunAt: manualReviewOnly,
      mediaCleaned: true, lease: null, message: needsReview,
    });
  });
}

async function runWork(ref: Ref, deps: Dependencies, budgetMs: number, manualCheck = false, parent?: AbortSignal) {
  const now = clock(deps);
  const deadline = performance.now() + budgetMs;
  if (parent?.aborted) return null;
  const claim = await claimWork(ref, manualCheck, now);
  if (!claim) return null;
  const { job, mode, leaseId, previousNextRunAt } = claim;
  const remaining = Math.floor(deadline - performance.now());
  if (parent && (parent.aborted || remaining < 1000)) {
    await releaseLease(ref, leaseId, previousNextRunAt).catch(() => {});
    return null;
  }
  const timeout = AbortSignal.timeout(Math.min(45_000, Math.max(1000, budgetMs)));
  const signal = Object.assign(parent ? AbortSignal.any([parent, timeout]) : timeout, {
    assertActive: () => {
      if (performance.now() >= deadline) throw new DOMException('YouTube upload work budget expired.', 'TimeoutError');
    },
  });
  try {
    if (mode === 'purge') await purgeWork(ref, job, leaseId, now);
    else if (mode === 'retain') {
      await retainReconciliation(ref, job, leaseId, now);
    } else if (mode === 'cleanup') {
      await media(deps).cleanup(mediaKey(job, ref), job.file, job.chunks, job.sourceGeneration, signal);
      const sweptAt = now();
      const unsettledWrite = Boolean(job.mediaWritePending || job.mediaWriteUncertain);
      // A DELETE 404 cannot prove a dispatched POST will not commit later. Revisit all paths
      // throughout this record's retention; the bucket's scoped lifecycle remains a backstop.
      const recheckAt = unsettledWrite && sweptAt < job.historyUntil ? Math.min(sweptAt + 60 * minute, job.historyUntil) : null;
      const cleanup = { mediaCleaned: recheckAt === null, mediaCleanupRecheckAt: recheckAt, mediaCleanupAttempts: 0 };
      await commitWork(ref, leaseId, { ...cleanup, lease: null, nextRunAt: nextAfterCleanup({ ...job, ...cleanup }, sweptAt) }, now);
    } else if (mode === 'expire') await expireWork(ref, job, leaseId, now);
    else if (mode !== 'check' && !job.measured && !job.video && !job.encryptedSession) await validateSource(ref, job, leaseId, signal, deps);
    else await uploadToYouTube(ref, job, mode, leaseId, signal, deps);
  } catch (error) {
    const failure = error instanceof YouTubeRequestNotSent ? error.reason : error;
    await workerFailure(ref, leaseId, mode, failure, now).catch(() => {});
  }
  return mode;
}

async function drainWork(ref: Ref, deps: Dependencies, budgetMs: number, manualCheck = false, parent?: AbortSignal) {
  const deadline = performance.now() + budgetMs;
  let steps = 0;
  while (steps < 6) {
    const remaining = Math.floor(deadline - performance.now());
    if (parent?.aborted || remaining < 1000 || steps > 0 && remaining < 5000) break;
    const mode = await runWork(ref, deps, remaining, manualCheck, parent);
    if (!mode) break;
    steps += 1;
    if (manualCheck && (mode !== 'cleanup' && mode !== 'retain' || steps >= 3)) break;
  }
  return steps;
}

export async function tickYouTubeUploads(options: { budgetMs?: number } = {}, deps: Dependencies = {}) {
  const database = db(deps);
  const now = clock(deps);
  const budget = Math.floor(Math.max(1000, Math.min(45_000, options.budgetMs ?? 30_000)));
  const deadline = performance.now() + budget;
  const signal = AbortSignal.timeout(budget);
  return withinUploadDeadline(async () => {
    const due = await database.collection(jobCollection).where('nextRunAt', '<=', now()).orderBy('nextRunAt').limit(4).get();
    for (const document of due.docs) {
      const remaining = Math.floor(deadline - performance.now());
      if (signal.aborted || remaining < 1000) break;
      const steps = await drainWork(document.ref, deps, remaining, false, signal);
      if (steps) return { processed: 1, steps };
    }
    return { processed: 0, steps: 0 };
  }, signal).catch(error => {
    if (signal.aborted && error === signal.reason) return { processed: 0, steps: 0 };
    throw error;
  });
}

async function cancelJob(ref: Ref, workspace: Ref, input: Scope, uid: string, now: () => number) {
  return ref.firestore.runTransaction(async tx => {
    await requireYouTubeUploadBusiness(tx, workspace, uid, input.businessId);
    const job = getJob(await tx.get(ref));
    if (!isInHistory(job, now())) throw notFound();
    if (job.state === 'cancelled') return job;
    if (!canCancelUpload(job, now())) {
      throw new ApiError(409, 'Unggahan ini sedang dikirim atau hasilnya perlu diperiksa di YouTube.', 'youtube_upload_cannot_cancel');
    }
    const dispatch = dispatchRef(workspace, input.businessId);
    const guard = (await tx.get(dispatch)).data();
    if (guard?.jobId === ref.id) tx.delete(dispatch);
    return update(tx, ref, job, finished(job, 'cancelled', now(), 'Unggahan dibatalkan.'), now());
  });
}

export function youtubeUploadAction(request: Request, rawId: string, deps: Dependencies = {}) {
  return respond(async () => {
    const id = operationId.parse(rawId);
    const input = actionInput.parse(await readJson(request, 4096));
    const actor = await readAccess(request, input, deps);
    const database = actor.ref.firestore;
    const ref = jobRef(database, jobKey(input, actor.user.uid, id));
    const now = clock(deps);
    if (input.action === 'cancel') return { ok: true, operation: dto(await cancelJob(ref, actor.ref, input, actor.user.uid, now), now()) };
    await database.runTransaction(async tx => {
      await requireYouTubeUploadBusiness(tx, actor.ref, actor.user.uid, input.businessId);
      const job = getJob(await tx.get(ref));
      if (!isInHistory(job, now())) throw notFound();
    });
    await drainWork(ref, deps, 30_000, input.action === 'check');
    const job = await database.runTransaction(async tx => {
      await requireYouTubeUploadBusiness(tx, actor.ref, actor.user.uid, input.businessId);
      return getJob(await tx.get(ref));
    });
    return { ok: true, operation: dto(job, clock(deps)()) };
  });
}
