import { withYouTubeUsage } from './youtube-production-usage';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { adminBucket, adminDb } from './firebase';
import { requireWorkspace, workspaceIdSchema } from './auth';
import { resolveBusinessContext } from './business-contexts';
import { resolveAdminModels } from './admin-settings';
import { DEFAULT_CONTENT_MODELS } from '../admin-settings';
import { effectiveWorkspacePlan } from '../subscription';
import { reserveGenerationAttempt } from './generation-policy';
import { ApiError, errorResponse, noStoreJson, readJson } from './http';
import { youtubeProductionSettings, youtubeVoiceSchema, youtubeBlockSchema, youtubeNarratorDelivery, validateScriptBlock, validateCast, youtubeSceneLocation, type YouTubeProduction, type YouTubeOutline, type YouTubeScriptBlock } from '../youtube-production';
import { importPacingIssue, parseYouTubeScript } from '../youtube-script-import';
import type { BrandProfile } from '../veloxa-types';
import { createYouTubeThumbnail, planYouTubeVideo, writeYouTubeBlock, suggestYouTubeScriptRevision, createYouTubeCharacter, createYouTubePhoto, youtubeShotContext } from './youtube-production-agent';
import { paceYouTubeSpeech } from './youtube-speech-pacing';
import { generateYouTubeNarration, generateDialogueVoiceover, generateCharacterVoiceSample } from './reels-voice';
import { composeYouTubeFrame, renderYouTubeScene, remuxYouTubeVideo, normalizeYouTubeSceneAudio, sceneFrameCounts, YOUTUBE_LAYOUT_VERSION } from './youtube-production-renderer';

// Development end-to-end runs use an isolated queue so a deployed older worker
// cannot claim a new-format script before that worker has been upgraded.
const collection = process.env.NODE_ENV === 'development' && process.env.VELOXA_YOUTUBE_QA_QUEUE === 'isolated'
  ? 'private_youtube_productions_qa' : 'private_youtube_productions';
const idle = Number.MAX_SAFE_INTEGER;
const scopeSchema = z.object({ workspaceId: workspaceIdSchema, businessId: z.string().regex(/^(primary|b_[a-f0-9-]{36})$/) });
type Scope = z.infer<typeof scopeSchema>;
type Ref = FirebaseFirestore.DocumentReference;
type Job = Omit<YouTubeProduction, 'blocks'> & { ownerUid: string; workspaceId: string; businessId: string; brand: BrandProfile;
  models: { scriptModel: string; imageModel: string; voiceModel: string }; fingerprint: string; scriptIndex: number;
  portraitIndex: number; imageIndex: number; audioIndex: number; renderIndex: number; totalFrames: number; sceneCounts?: number[]; narratorReferenceScene?: number; narrativeComposition?: boolean;
  importQuotaPending?: boolean; nextRunAt: number; attempts: number; lease: { id: string; until: number } | null; sourceGeneration?: string; characterVersions?: Record<string, number>;
  stoppedFrom?: Exclude<YouTubeProduction['state'], 'cancelled' | 'ready'>;
  lastFailure?: { phase: string; code: string; status: number | null; at: number; unit?: number; layoutVersion?: number } };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (scope: Scope, uid: string, id: string) => `${digest([scope.workspaceId, scope.businessId, uid])}_${id}`;
const mediaPath = (ref: Ref, name: string) => `private-youtube-productions/${ref.id}/${name}`;
const object = (ref: Ref, name: string) => adminBucket().file(mediaPath(ref, name));
function characterMediaName(job: Pick<Job, 'characterVersions'>, id: string, extension: 'jpg' | 'wav') {
  return `${id}-v${job.characterVersions?.[id] ?? 1}.${extension}`;
}
const blockRef = (ref: Ref, index: number) => ref.collection('blocks').doc(String(index).padStart(3, '0'));
const sceneRef = (ref: Ref, index: number) => ref.collection('scenes').doc(String(index).padStart(4, '0'));
type Dependencies = {
  authorize?: typeof requireWorkspace; models?: typeof resolveAdminModels;
  reserve?: typeof reserveGenerationAttempt; plan?: typeof planYouTubeVideo; script?: typeof writeYouTubeBlock; suggest?: typeof suggestYouTubeScriptRevision;
};
async function save(ref: Ref, name: string, bytes: Buffer, contentType: string) {
  await object(ref, name).save(bytes, { resumable: false, timeout: 30_000, metadata: { contentType, cacheControl: 'private, no-store' } });
}
async function bytes(ref: Ref, name: string, max = 20 * 1024 * 1024) {
  const file = object(ref, name), [metadata] = await file.getMetadata();
  if (Number(metadata.size) > max) throw new Error('Media produksi terlalu besar.');
  const [value] = await file.download({ validation: 'crc32c' }); return value;
}
async function dto(ref: Ref, job: Job): Promise<YouTubeProduction> {
  const scripts = await ref.collection('blocks').orderBy('index').get();
  return { ...(job.thumbnailSubmitted ? { thumbnailSubmitted: true } : {}), ...(job.thumbnails ? { thumbnails: job.thumbnails } : {}), ...(job.aiUsage ? { aiUsage: job.aiUsage } : {}), id: job.id, revision: job.revision, settings: job.settings, state: job.state,
    ...(job.scriptSource ? { scriptSource: job.scriptSource } : {}), ...(job.outline ? { outline: job.outline } : {}), blocks: scripts.docs.map(doc => doc.data() as YouTubeScriptBlock),
    completedScenes: job.renderIndex, createdAt: job.createdAt, updatedAt: job.updatedAt,
    progress: { images: job.imageIndex, audio: job.audioIndex, rendered: job.renderIndex, characters: job.portraitIndex,
      attempts: job.attempts, working: Boolean(job.lease && job.lease.until > Date.now()), checkedAt: Date.now() },
    ...(job.retryAt ? { retryAt: job.retryAt } : {}), ...(job.message ? { message: job.message } : {}),
    ...(job.durationSeconds ? { durationSeconds: job.durationSeconds } : {}), ...(job.videoBytes ? { videoBytes: job.videoBytes } : {}),
    ...(job.sceneFrames ? { sceneFrames: job.sceneFrames } : {}),
    portraits: job.settings.characters.slice(0, job.portraitIndex).map(actor => actor.id) };
}
async function access(request: Request, deps: Dependencies = {}) {
  const params = new URL(request.url).searchParams;
  const scope = scopeSchema.parse({ workspaceId: params.get('workspaceId'), businessId: params.get('businessId') });
  const actor = await (deps.authorize ?? requireWorkspace)(request, scope.workspaceId, true);
  if (actor.workspace.ownerUid !== actor.user.uid) throw new ApiError(403, 'Studio YouTube tersedia untuk pemilik workspace.');
  await resolveBusinessContext(actor.ref, actor.workspace, scope.businessId);
  return { ...scope, actor };
}
async function owned(request: Request, rawId: string, deps: Dependencies = {}) {
  const id = z.uuid().parse(rawId), context = await access(request, deps);
  const ref = context.actor.ref.firestore.collection(collection).doc(key(context, context.actor.user.uid, id));
  const job = (await ref.get()).data() as Job | undefined;
  if (!job || job.ownerUid !== context.actor.user.uid) throw new ApiError(404, 'Produksi video tidak ditemukan.');
  return { ref, job, context };
}
async function checkProductionGuard(tx: FirebaseFirestore.Transaction, guard: Ref, ref: Ref) {
  const activeKey = (await tx.get(guard)).data()?.jobKey;
  if (typeof activeKey !== 'string' || activeKey === ref.id) return;
  const active = (await tx.get(ref.firestore.collection(collection).doc(activeKey))).data() as Job | undefined;
  if (active && !['ready', 'cancelled'].includes(active.state)) throw new ApiError(409, 'Selesaikan atau hentikan produksi sebelumnya terlebih dahulu.');
}
function resumeStage(job: Job): YouTubeProduction['state'] {
  if (job.state === 'cancelled' && job.stoppedFrom && job.stoppedFrom !== 'attention') return job.stoppedFrom;
  if (!job.outline) return 'planning';
  if (job.scriptIndex < job.settings.minutes) return 'scripting';
  // Older stopped drafts have no saved stage. Preserve approval gates unless a
  // media checkpoint proves the owner already started that phase.
  if (job.state === 'cancelled' && !job.stoppedFrom && !job.imageIndex && !job.audioIndex && !job.renderIndex) {
    if (!job.portraitIndex) return 'script_review';
    if (job.portraitIndex === job.settings.characters.length) return 'character_review';
  }
  return job.portraitIndex < job.settings.characters.length ? 'characters' : 'producing';
}
export async function youtubeProductionApi(request: Request, rawId?: string, deps: Dependencies = {}) {
  try {
    if (request.method === 'GET') {
      if (rawId) { const { ref, job } = await owned(request, rawId, deps); return noStoreJson({ production: await dto(ref, job) }); }
      const context = await access(request, deps);
      const prefix = digest([context.workspaceId, context.businessId, context.actor.user.uid]) + ':';
      const docs = await context.actor.ref.firestore.collection(collection).orderBy('listKey').startAt(prefix).endAt(prefix + '\uf8ff').limit(8).get();
      const items = docs.docs.map(doc => ({ ref: doc.ref, job: doc.data() as Job })).sort((a, b) => b.job.createdAt - a.job.createdAt).slice(0, 8);
      return noStoreJson({ productions: await Promise.all(items.map(({ ref, job }) => dto(ref, job))) });
    }
    if (!rawId) {
      const context = await access(request, deps);
      const input = z.object({ id: z.uuid(), settings: youtubeProductionSettings, scriptText: z.string().min(1).max(480000).optional() }).strict().parse(await readJson(request, 2 * 1024 * 1024));
      if (new Set(input.settings.characters.map(actor => actor.id)).size !== input.settings.characters.length) throw new ApiError(400, 'ID karakter harus unik.');
      let imported: YouTubeScriptBlock[] | undefined;
      if (input.scriptText !== undefined) {
        try { imported = parseYouTubeScript(input.scriptText, input.settings.characters, input.settings.kind); }
        catch (error) { throw new ApiError(400, (error as Error).message); }
        if (imported.length !== input.settings.minutes) throw new ApiError(400, 'Jumlah menit dalam naskah harus sesuai durasi produksi.');
      }
      const { context: business } = await resolveBusinessContext(context.actor.ref, context.actor.workspace, context.businessId);
      if (!business.brand.businessName) throw new ApiError(409, 'Simpan profil bisnis sebelum membuat video.');
      const ref = context.actor.ref.firestore.collection(collection).doc(key(context, context.actor.user.uid, input.id));
      const fingerprint = digest(input);
      const models = { ...DEFAULT_CONTENT_MODELS, ...await (deps.models ?? resolveAdminModels)(ref.firestore, context.workspaceId) };
      const guard = context.actor.ref.collection('youtube_production_guards').doc(context.businessId);
      const job = await ref.firestore.runTransaction(async tx => {
        const current = (await tx.get(ref)).data() as Job | undefined;
        if (current) { if (current.fingerprint !== fingerprint) throw new ApiError(409, 'ID produksi sudah digunakan untuk topik berbeda.'); return current; }
        if (!imported) await checkProductionGuard(tx, guard, ref);
        const now = Date.now();
        const job: Job = { id: input.id, workspaceId: context.workspaceId, businessId: context.businessId, ownerUid: context.actor.user.uid,
          brand: business.brand, settings: input.settings, models, narrativeComposition: true, aiUsage: { partial: false, stages: {} }, fingerprint, revision: 1, state: 'planning',
          scriptIndex: 0, portraitIndex: 0, imageIndex: 0, audioIndex: 0, renderIndex: 0, totalFrames: 0, sceneCounts: [],
          completedScenes: 0, createdAt: now, updatedAt: now, nextRunAt: now, attempts: 0, lease: null };
        if (imported) {
          job.scriptSource = 'imported';
          job.importQuotaPending = true;
          job.state = 'script_review';
          job.nextRunAt = idle;
          job.outline = { title: input.settings.topic, description: '', chapters: imported.map(block => block.chapter) };
          job.scriptIndex = imported.length;
          job.sceneCounts = imported.map(block => block.scenes.length);
          for (const block of imported) tx.create(blockRef(ref, block.index), block);
        } else {
          tx.set(guard, { jobKey: ref.id });
        }
        tx.create(ref, { ...job, listKey: `${digest([context.workspaceId, context.businessId, context.actor.user.uid])}:${String(9_999_999_999_999 - now).padStart(13, '0')}:${input.id}` });
        tx.set(context.actor.ref.collection('youtube_production_quotas').doc(input.id), { state: 'generating' });
        return job;
      });
      return noStoreJson({ production: await dto(ref, job) });
    }
    const { ref, context, job } = await owned(request, rawId, deps);
    const input = z.discriminatedUnion('action', [
      z.object({ action: z.literal('thumbnail'), slot: z.union([z.literal(0), z.literal(1)]), expected: z.uuid().nullable(), note: z.string().trim().max(1000) }).strict(),
      z.object({ action: z.literal('select_thumbnail'), id: z.uuid() }).strict(),
      z.object({ action: z.literal('process') }).strict(),
      z.object({ action: z.enum(['approve_script', 'approve_characters', 'stop', 'resume', 'retry_now']), revision: z.number().int(), confirmed: z.literal(true) }).strict(),
      z.object({ action: z.literal('suggest_edit'), revision: z.number().int(), index: z.number().int().min(0).max(119),
        note: z.string().trim().min(1).max(2000), block: youtubeBlockSchema }).strict(),
      z.object({ action: z.literal('edit'), revision: z.number().int(), index: z.number().int().min(0).max(119), block: youtubeBlockSchemaForEdit() }).strict(),
      z.object({ action: z.literal('revise_character'), revision: z.number().int(), characterId: z.string().regex(/^actor_[1-5]$/), appearance: z.string().trim().min(15).max(1000), voice: youtubeVoiceSchema, delivery: z.string().trim().max(500), confirmed: z.literal(true) }).strict(),
    ]).parse(await readJson(request));
    if (input.action === 'thumbnail' || input.action === 'select_thumbnail') {
      const action = input, token = randomUUID();
      const leaseKey = 'thumbnailLease';
      const update = (phase: 'start' | 'save' | 'release') => ref.firestore.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (!current) throw new ApiError(404, 'Produksi tidak ditemukan.');
        if (phase === 'release') {
          if (current[leaseKey]?.id === token) tx.update(ref, { [leaseKey]: null });
          return;
        }
        if (current.thumbnailSubmitted) throw new ApiError(409, 'Video sudah masuk antrean pengiriman. Kelola thumbnail untuk video ini di YouTube Studio.');
        if (current.settings.kind !== 'video' || !['characters', 'character_review', 'producing', 'ready'].includes(current.state))
          throw new ApiError(409, 'Setujui naskah video panjang sebelum membuat thumbnail.');
        const thumbnails = current.thumbnails ?? { options: [null, null], selected: null };
        if (action.action === 'select_thumbnail') {
          if (!thumbnails.options.includes(action.id)) throw new ApiError(409, 'Usulan berubah. Muat ulang Studio.');
          tx.update(ref, { thumbnails: { ...thumbnails, selected: action.id }, revision: current.revision + 1 });
        } else if (thumbnails.options[action.slot] !== action.expected) {
          throw new ApiError(409, 'Usulan sudah berubah. Muat ulang Studio.');
        } else if (phase === 'start') {
          if (current[leaseKey]?.until > Date.now()) throw new ApiError(409, 'Thumbnail sedang dibuat. Tunggu sebentar, lalu muat ulang.');
          tx.update(ref, { [leaseKey]: { id: token, until: Date.now() + 180_000 } });
        } else {
          if (current[leaseKey]?.id !== token) throw new ApiError(409, 'Percobaan sudah diganti. Muat ulang Studio.');
          const options = [...thumbnails.options];
          options[action.slot] = token;
          tx.update(ref, { thumbnails: { ...thumbnails, options }, [leaseKey]: null, revision: current.revision + 1 });
        }
      });
      await update('start');
      if (action.action === 'thumbnail') {
        try {
          const opening = (await blockRef(ref, 0).get()).data();
          const sceneText = (opening?.scenes ?? []).map((scene: { narration: string }) => scene.narration).join(' ');
          const story = [job.outline?.description, sceneText].join(' ').slice(0, 4500);
          const original = action.expected ? await bytes(ref, 'thumb-' + action.expected + '.jpg') : undefined;
          const image = await withYouTubeUsage(ref, () => createYouTubeThumbnail(job.outline?.title ?? job.settings.topic, story, action.slot, action.note, job.models.imageModel, original));
          await save(ref, 'thumb-' + token + '.jpg', image, 'image/jpeg');
          await update('save');
        } finally {
          await update('release');
        }
      }
      return noStoreJson({ production: await dto(ref, (await ref.get()).data() as Job) });
    }
    if (input.action === 'suggest_edit') {
      if (job.state !== 'script_review' || job.revision !== input.revision || !job.outline || input.index >= job.scriptIndex)
        throw new ApiError(409, 'Naskah sudah berubah. Buka kembali menit yang ingin direvisi.');
      const proposal = await withYouTubeUsage(ref, () => (deps.suggest ?? suggestYouTubeScriptRevision)(job.settings, job.outline!, input.index, input.block.scenes, input.note, job.models.scriptModel));
      return noStoreJson({ proposal });
    }
    if (input.action === 'approve_script' && job.scriptSource === 'imported') {
      const saved = await ref.collection('blocks').orderBy('index').get();
      const issue = importPacingIssue(saved.docs.map(doc => doc.data() as YouTubeScriptBlock));
      if (issue) throw new ApiError(400, issue);
    }
    const savedCounts = input.action === 'edit' ? (await ref.collection('blocks').orderBy('index').get()).docs.map(doc => (doc.data() as YouTubeScriptBlock).scenes.length) : [];
    if (input.action === 'process') await runYouTubeProductionStep(ref, deps);
    else await ref.firestore.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as Job;
      const workspace = (await tx.get(context.actor.ref)).data();
      if (workspace?.ownerUid !== current.ownerUid) throw new ApiError(403, 'Pemilik workspace telah berubah.');
      if (input.action === 'stop') {
        if (current.state === 'ready') throw new ApiError(409, 'Video sudah selesai.');
        if (current.state !== 'cancelled') tx.update(ref, { state: 'cancelled', stoppedFrom: current.state, nextRunAt: idle, lease: null,
          retryAt: 0, attempts: 0, message: '', revision: current.revision + 1, updatedAt: Date.now() });
        return;
      }
      if (current.revision !== input.revision || current.lease && current.lease.until > Date.now()) throw new ApiError(409, 'Produksi sedang berubah. Muat status terbaru.');
      const patch: Partial<Job> = { revision: current.revision + 1, updatedAt: Date.now(), attempts: 0, message: '', retryAt: 0 };
      if (input.action === 'edit') {
        if (current.state !== 'script_review' || input.index >= current.settings.minutes) throw new ApiError(409, 'Naskah hanya dapat diedit sebelum produksi.');
        const block = { ...validateScriptBlock(input.block, current.scriptSource === 'imported'), index: input.index, chapter: current.outline!.chapters[input.index] };
        validateCast(block, current.settings); tx.set(blockRef(ref, input.index), block);
        patch.sceneCounts = savedCounts.map((count, index) => index === input.index ? block.scenes.length : count);
      } else if (input.action === 'revise_character') {
        const index = current.settings.characters.findIndex(actor => actor.id === input.characterId);
        if (current.state !== 'character_review' || index < 0 || current.imageIndex !== 0) throw new ApiError(409, 'Pemeran hanya dapat diubah pada tahap tinjauan acuan.');
        patch.settings = { ...current.settings, characters: current.settings.characters.map(actor => actor.id === input.characterId ? { ...actor, appearance: input.appearance, voice: input.voice, delivery: input.delivery } : actor) };
        patch.characterVersions = { ...current.characterVersions, [input.characterId]: (current.characterVersions?.[input.characterId] ?? 1) + 1 };
        patch.portraitIndex = index; patch.state = 'characters'; patch.nextRunAt = Date.now();
      } else if (input.action === 'approve_script') {
        if (current.state !== 'script_review' || current.scriptIndex !== current.settings.minutes) throw new ApiError(409, 'Tinjau naskah lengkap sebelum produksi.');
        if (current.scriptSource === 'imported') {
          const guard = context.actor.ref.collection('youtube_production_guards').doc(context.businessId);
          await checkProductionGuard(tx, guard, ref);
          tx.set(guard, { jobKey: ref.id });
        }
        patch.state = current.settings.characters.length ? 'characters' : 'producing'; patch.nextRunAt = Date.now();
      } else if (input.action === 'approve_characters') {
        if (current.state !== 'character_review' || current.portraitIndex !== current.settings.characters.length) throw new ApiError(409, 'Acuan karakter belum lengkap.');
        patch.state = 'producing'; patch.nextRunAt = Date.now();
      } else if (input.action === 'retry_now') {
        if (current.state !== 'producing' || current.attempts < 1) throw new ApiError(409, 'Produksi tidak sedang menunggu percobaan ulang.');
        patch.nextRunAt = Date.now(); patch.attempts = current.attempts;
      } else {
        if (current.state !== 'attention' && current.state !== 'cancelled') throw new ApiError(409, 'Produksi tidak menunggu pemulihan.');
        patch.state = resumeStage(current);
        if (patch.state !== 'script_review' || current.scriptSource !== 'imported') {
          const guard = context.actor.ref.collection('youtube_production_guards').doc(context.businessId);
          await checkProductionGuard(tx, guard, ref);
          tx.set(guard, { jobKey: ref.id });
        }
        patch.nextRunAt = patch.state === 'script_review' || patch.state === 'character_review' ? idle : Date.now();
      }
      tx.update(ref, patch);
    });
    return noStoreJson({ production: await dto(ref, (await ref.get()).data() as Job) });
  } catch (error) { return errorResponse(error); }
}
function youtubeBlockSchemaForEdit() {
    return z.object({ scenes: z.array(z.object({ title: z.string(), supporting: z.string(), narration: z.string(),
    visual: z.string(), lines: z.array(z.object({ speakerId: z.string(), text: z.string() }).strict()), characterIds: z.array(z.string()) }).strict()).min(1) }).strict();
}

async function claim(ref: Ref) {
  const leaseId = randomUUID();
  const job = await ref.firestore.runTransaction(async tx => {
    const job = (await tx.get(ref)).data() as Job | undefined;
    if (!job || !['planning', 'scripting', 'characters', 'producing'].includes(job.state) || job.nextRunAt > Date.now() || job.lease && job.lease.until > Date.now()) return null;
    const workspace = ref.firestore.collection('workspaces').doc(job.workspaceId);
    const saved = (await tx.get(workspace)).data();
    if (!saved || saved.ownerUid !== job.ownerUid) { tx.update(ref, { state: 'attention', message: 'Pemilik workspace telah berubah.', nextRunAt: idle }); return null; }
    // Business existence is checked on every resumption, including scheduler invocations.
    await resolveBusinessContext(workspace, saved, job.businessId, tx);
    tx.update(ref, { lease: { id: leaseId, until: Date.now() + 240_000 } });
    return job;
  });
  return job ? { job, leaseId } : null;
}
async function commit(ref: Ref, leaseId: string, patch: Partial<Job>, writes?: (tx: FirebaseFirestore.Transaction) => void) {
  await ref.firestore.runTransaction(async tx => {
    const current = (await tx.get(ref)).data() as Job;
    if (current.lease?.id !== leaseId || current.lease.until <= Date.now()) throw new Error('Produksi dilanjutkan proses lain.');
    const ws = (await tx.get(ref.firestore.collection('workspaces').doc(current.workspaceId))).data();
    if (ws?.ownerUid !== current.ownerUid) throw new Error('Pemilik workspace telah berubah.');
    writes?.(tx);
    tx.update(ref, { ...patch, lease: null, attempts: 0, message: '', retryAt: 0, nextRunAt: patch.nextRunAt ?? Date.now(), revision: current.revision + 1, updatedAt: Date.now() });
  });
}
export async function runYouTubeProductionStep(ref: Ref, deps: Dependencies = {}) {
  return withYouTubeUsage(ref, () => processYouTubeStep(ref, deps));
}
async function processYouTubeStep(ref: Ref, deps: Dependencies) {
  const claimed = await claim(ref); if (!claimed) return;
  const { job, leaseId } = claimed;
  try {
    // Older productions did not store a scene manifest. Derive it from their saved
    // scripts once; never infer positions from a fixed number of pictures per minute.
    if (!job.sceneCounts || job.sceneCounts.length !== job.scriptIndex) {
      const scripts = await ref.collection('blocks').orderBy('index').get();
      const counts = scripts.docs.map(doc => (doc.data() as YouTubeScriptBlock).scenes.length);
      if (counts.length !== job.scriptIndex) throw new Error('Naskah tersimpan belum lengkap.');
      await ref.firestore.runTransaction(async tx => {
        const current = (await tx.get(ref)).data() as Job;
        if (current.lease?.id !== leaseId) throw new Error('Produksi dilanjutkan proses lain.');
        tx.update(ref, { sceneCounts: counts });
      });
      job.sceneCounts = counts;
    }
    if (job.state === 'planning' || job.importQuotaPending) {
      const workspace = ref.firestore.collection('workspaces').doc(job.workspaceId);
      const ws = (await workspace.get()).data()!;
      await (deps.reserve ?? reserveGenerationAttempt)(workspace, workspace.id, effectiveWorkspacePlan(ws), workspace.collection('youtube_production_quotas').doc(job.id));
      if (job.importQuotaPending) { await commit(ref, leaseId, { importQuotaPending: false }); return; }
      const outline = await (deps.plan ?? planYouTubeVideo)(job.settings, job.brand, job.models.scriptModel);
      await commit(ref, leaseId, { outline, state: 'scripting' }); return;
    }
    if (job.state === 'scripting') {
      const previous = job.scriptIndex ? (await blockRef(ref, job.scriptIndex - 1).get()).data() as YouTubeScriptBlock : null;
      const block = await (deps.script ?? writeYouTubeBlock)(job.settings, job.brand, job.outline as YouTubeOutline, job.scriptIndex, previous, job.models.scriptModel);
      const complete = job.scriptIndex + 1 === job.settings.minutes;
      await commit(ref, leaseId, { scriptIndex: job.scriptIndex + 1, sceneCounts: [...job.sceneCounts, block.scenes.length], ...(complete ? { state: 'script_review', nextRunAt: idle } : {}) }, tx => tx.set(blockRef(ref, block.index), block)); return;
    }
    if (job.state === 'characters') {
      const actor = job.settings.characters[job.portraitIndex];
      const portraitName = characterMediaName(job, actor.id, 'jpg'), voiceName = characterMediaName(job, actor.id, 'wav');
      if (!(await object(ref, portraitName).exists())[0]) {
        const portrait = await createYouTubeCharacter(actor, job.models.imageModel);
        await save(ref, portraitName, portrait, 'image/jpeg');
      }
      if (!(await object(ref, voiceName).exists())[0]) {
        if ((await ref.get()).data()?.lease?.id !== leaseId) return;
        const sample = await generateCharacterVoiceSample(actor.name, actor.voice, actor.delivery, job.models.voiceModel);
        await save(ref, voiceName, sample, 'audio/wav');
      }
      const complete = job.portraitIndex + 1 === job.settings.characters.length;
      await commit(ref, leaseId, { portraitIndex: job.portraitIndex + 1, ...(complete ? { state: 'character_review', nextRunAt: idle } : {}) }); return;
    }
    const count = job.sceneCounts.reduce((sum, count) => sum + count, 0);
    if (job.imageIndex < count) {
      const cached = await Promise.all(['photo.jpg', 'overlay.png', 'preview.jpg'].map(suffix => object(ref, `${job.imageIndex}-${suffix}`).exists()));
      if (cached.every(([exists]) => exists)) { await commit(ref, leaseId, { imageIndex: job.imageIndex + 1 }); return; }
      const location = youtubeSceneLocation(job.sceneCounts, job.imageIndex);
      const block = (await blockRef(ref, location.blockIndex).get()).data() as YouTubeScriptBlock;
      const scene = block.scenes[location.sceneIndex];
      const portraits = await Promise.all(scene.characterIds.map(async id => ({ id, bytes: await bytes(ref, characterMediaName(job, id, 'jpg')) })));
      const previousLocation = job.imageIndex ? youtubeSceneLocation(job.sceneCounts, job.imageIndex - 1) : null;
      const previousBlock = previousLocation && previousLocation.blockIndex !== location.blockIndex ? (await blockRef(ref, previousLocation.blockIndex).get()).data() as YouTubeScriptBlock : block;
      const priorScene = previousLocation ? previousBlock.scenes[previousLocation.sceneIndex] : undefined;
      const previous = priorScene ? { visual: priorScene.visual, narration: priorScene.narration } : undefined;
      const candidateName = `${job.imageIndex}-candidate.jpg`;
      const hasCandidate = (await object(ref, candidateName).exists())[0];
      const rejectedCandidate = job.lastFailure?.code === 'photo_layout' && job.lastFailure.unit === job.imageIndex && job.lastFailure.layoutVersion === YOUTUBE_LAYOUT_VERSION;
      const photo = hasCandidate && !rejectedCandidate ? await bytes(ref, candidateName)
        : await createYouTubePhoto(scene, job.settings, job.brand, job.models.imageModel, portraits, previous, rejectedCandidate, job.narrativeComposition, job.imageIndex, youtubeShotContext(job.outline, block, location.sceneIndex));
      // A stop during the provider call invalidates this lease before its result enters the gallery.
      if ((await ref.get()).data()?.lease?.id !== leaseId) return;
      // Save the generated candidate before layout checks, so diagnostics and repair
      // can reuse it instead of paying for another image after an interrupted write.
      if (!hasCandidate || rejectedCandidate) await save(ref, candidateName, photo, 'image/jpeg');
      const frame = await composeYouTubeFrame(photo, scene, job.settings, job.brand, job.imageIndex, job.narrativeComposition);
      await Promise.all([save(ref, `${job.imageIndex}-photo.jpg`, frame.photo, 'image/jpeg'), save(ref, `${job.imageIndex}-overlay.png`, frame.overlay, 'image/png'), save(ref, `${job.imageIndex}-preview.jpg`, frame.image, 'image/jpeg')]);
      await commit(ref, leaseId, { imageIndex: job.imageIndex + 1 }); return;
    }
    if (job.audioIndex < job.settings.minutes) {
      const block = (await blockRef(ref, job.audioIndex).get()).data() as YouTubeScriptBlock;
      const scenes = block.scenes.map(scene => ({ lines: scene.lines.map(line => {
        const character = job.settings.characters.find(actor => actor.id === line.speakerId);
        return { text: line.text, voice: character?.voice ?? job.settings.voice, delivery: character ? `${character.name}. ${character.delivery}` : youtubeNarratorDelivery(job.settings) };
      }) }));
      // A retry of deterministic TTS must change the rate if the previous take missed the chapter length.
      const previousRateError = job.attempts > 0 ? job.lastFailure?.code : undefined;
      const achirdSpeakingRate = previousRateError === 'achird_too_short' ? .82 : previousRateError === 'achird_too_long' ? 1.16 : 1;
      const voiceOptions = { model: job.models.voiceModel, timeoutMs: 150_000, achirdSpeakingRate };
      const delivery = youtubeNarratorDelivery(job.settings) + (job.attempts && job.lastFailure?.code === 'youtube_narration_pacing'
        ? ' Baca bagian ini dalam sekitar 54 detik. Jaga aliran kata di dalam frasa. Jeda antargambar disiapkan saat penyuntingan.' : '');
      const hasCharacterDialogue = block.scenes.some(scene => scene.lines.some(line => line.speakerId !== 'narrator'));
      // Older narrator-only jobs already have a usable reference in their opening scene.
      const referenceScene = job.narratorReferenceScene ?? (job.audioIndex > 0 && !job.settings.characters.length ? 0 : undefined);
      const voice = hasCharacterDialogue || job.settings.voice === 'achird'
        ? await generateDialogueVoiceover(scenes, { ...voiceOptions, continuousNarrator: !hasCharacterDialogue })
        : await generateYouTubeNarration(block.scenes.map(scene => scene.narration), {
          ...voiceOptions, voice: job.settings.voice, delivery,
          referencePcm: referenceScene === undefined ? undefined : await bytes(ref, `${referenceScene}.pcm`),
        });
      const usesAchird = scenes.some(scene => scene.lines.some(line => line.voice === 'achird'));
      const rawSeconds = voice.pcm.length / 48000;
      if (!voice.sceneDurations || voice.sceneDurations.length !== block.scenes.length || (!usesAchird && (rawSeconds < 44 || rawSeconds > 79))) throw new Error('Suara belum sesuai durasi naskah.');
      const paced = 'continuousNarration' in voice && voice.continuousNarration
        ? { pcm: voice.pcm, sceneDurations: voice.sceneDurations }
        : paceYouTubeSpeech(voice.pcm, voice.sceneDurations, block.scenes.map(scene => scene.narration));
      const targetSeconds = job.settings.kind === 'short' ? 59.8 : 60;
      const frames = sceneFrameCounts(paced.sceneDurations, targetSeconds);
      // Retake upstream while the recording is still replaceable. Never save a timeline
      // that requires rushing the narration or that the renderer cannot normalize.
      if (paced.sceneDurations.some((seconds, i) => seconds * 25 / frames[i] > (hasCharacterDialogue ? 1.35 : 1.2) || seconds * 25 / frames[i] < .72)) {
        const reason = usesAchird ? (paced.pcm.length / 48000 < targetSeconds ? 'achird_too_short' : 'achird_too_long') : 'youtube_narration_pacing';
        throw new ApiError(503, 'Narasi perlu direkam kembali agar nyaman diikuti.', reason);
      }
      let offset = 0;
      const firstScene = job.sceneCounts.slice(0, job.audioIndex).reduce((sum, count) => sum + count, 0);
      for (let i = 0; i < block.scenes.length; i++) {
        const size = Math.round(paced.sceneDurations[i] * 24000) * 2;
        await save(ref, `${firstScene + i}.pcm`, paced.pcm.subarray(offset, offset + size), 'application/octet-stream'); offset += size;
      }
      if (offset !== paced.pcm.length) throw new Error('Batas dialog belum sesuai audio tersimpan.');
      const narratorScene = block.scenes.findIndex(scene => scene.lines.every(line => line.speakerId === 'narrator'));
      await commit(ref, leaseId, { ...(referenceScene === undefined && narratorScene >= 0 ? { narratorReferenceScene: firstScene + narratorScene } : {}), audioIndex: job.audioIndex + 1, sceneFrames: [...(job.sceneFrames ?? []).slice(0, firstScene), ...frames] }, tx => frames.forEach((frameCount, i) => tx.set(sceneRef(ref, firstScene + i), { frames: frameCount, ...(job.narrativeComposition ? { caption: block.scenes[i].narration } : {}) }))); return;
    }
    if (job.renderIndex < count) {
      const index = job.renderIndex;
      const [photo, overlay, pcm, previousFrame, scene] = await Promise.all([bytes(ref, `${index}-photo.jpg`), bytes(ref, `${index}-overlay.png`), bytes(ref, `${index}.pcm`), index ? bytes(ref, `${index - 1}-last.jpg`) : undefined, sceneRef(ref, index).get()]);
      const frames = Number(scene.data()?.frames);
      const result = await renderYouTubeScene({ photo, overlay, pcm, previousFrame, frames, caption: scene.data()?.caption, startFrame: job.totalFrames, index, kind: job.settings.kind });
      await Promise.all([save(ref, `${index}.ts`, result.ts, 'video/mp2t'), save(ref, `${index}-render.pcm`, result.audio, 'application/octet-stream'), save(ref, `${index}-last.jpg`, result.last, 'image/jpeg')]);
      await commit(ref, leaseId, { renderIndex: index + 1, totalFrames: job.totalFrames + frames }); return;
    }
    // Stream the encoded segments in order with backpressure. No giant Buffer or browser upload.
    const source = Readable.from((async function* () {
      for (let index = 0; index < count; index++) for await (const chunk of object(ref, `${index}.ts`).createReadStream()) yield chunk;
    })());
    const audio = Readable.from((async function* () {
      for (let index = 0; index < count; index++) {
        const file = object(ref, `${index}-render.pcm`);
        // Resume media created before continuous audio was introduced, without
        // generating another voice or redoing already approved pictures.
        if (!(await file.exists())[0]) {
          const scene = (await sceneRef(ref, index).get()).data();
          await save(ref, `${index}-render.pcm`, await normalizeYouTubeSceneAudio(await bytes(ref, `${index}.pcm`), Number(scene?.frames)), 'application/octet-stream');
        }
        for await (const chunk of file.createReadStream()) yield chunk;
      }
    })());
    const final = object(ref, 'final.mp4');
    await remuxYouTubeVideo(source, audio, final.createWriteStream({ resumable: true, metadata: { contentType: 'video/mp4', cacheControl: 'private, no-store' } }), job.totalFrames);
    const [metadata] = await final.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > 4 * 1024 ** 3) throw new Error('Video akhir perlu diperiksa.');
    await commit(ref, leaseId, { state: 'ready', nextRunAt: idle, durationSeconds: job.totalFrames / 25, videoBytes: size, sourceGeneration: String(metadata.generation) });
  } catch (error) {
    const phase = job.state === 'planning' ? 'outline' : job.state === 'scripting' ? 'script' : job.state === 'characters' ? 'characters'
      : job.imageIndex < (job.sceneCounts ?? []).reduce((a, b) => a + b, 0) ? 'images' : job.audioIndex < job.settings.minutes ? 'audio' : job.renderIndex < (job.sceneCounts ?? []).reduce((a, b) => a + b, 0) ? 'render' : 'merge';
    const raw = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
    const code = raw.message === 'Foto perlu ruang teks yang lebih tenang. Adegan ini akan diperbaiki.' ? 'photo_layout'
      : typeof raw.code === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(raw.code) ? raw.code
      : typeof raw.name === 'string' && /^[a-z0-9_]{1,80}$/i.test(raw.name) ? raw.name : 'production_step_error';
    const lastFailure = { phase, code, status: typeof raw.status === 'number' ? raw.status : null, at: Date.now(),
      ...(phase === 'images' ? { unit: job.imageIndex } : {}), ...(code === 'photo_layout' ? { layoutVersion: YOUTUBE_LAYOUT_VERSION } : {}) };
    console.error('youtube_production_step_retry', { productionId: job.id, ...lastFailure });
    await ref.firestore.runTransaction(async tx => {
      const current = (await tx.get(ref)).data() as Job;
      if (current.lease?.id !== leaseId) return;
      const attempts = current.attempts + 1;
      const attention = attempts >= 8 || error instanceof ApiError && [400, 401, 403, 409, 429].includes(error.status);
      const retryAt = Date.now() + Math.min(300_000, 15_000 * 2 ** Math.min(attempts, 5));
      const attentionMessage = code === 'photo_layout'
        ? `Teks pada gambar adegan ${job.imageIndex + 1} belum terbaca selama kamera bergerak. Lanjutkan produksi yang sama untuk memperbaiki adegan ini.`
        : error instanceof ApiError ? error.message : 'Satu bagian belum selesai setelah beberapa percobaan. Bagian yang berhasil tetap tersimpan; lanjutkan produksi yang sama.';
      tx.update(ref, { lease: null, attempts, lastFailure, revision: current.revision + 1, updatedAt: Date.now(),
        ...(attention ? { state: 'attention', nextRunAt: idle, message: attentionMessage } : { nextRunAt: retryAt, retryAt, message: 'Sedang memperbaiki bagian yang belum selesai. Hasil sebelumnya tetap tersimpan.' }) });
    });
  }
}
export async function tickYouTubeProductions() {
  const docs = await adminDb().collection(collection).where('nextRunAt', '<=', Date.now()).orderBy('nextRunAt').limit(1).get();
  for (const doc of docs.docs) await runYouTubeProductionStep(doc.ref);
  return { inspected: docs.size };
}
export const productionMediaAccess = { owned, object, collection, characterMediaName };
