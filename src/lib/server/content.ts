import { randomUUID } from 'node:crypto';
import { businessCategoryLabel } from '../business-categories';
import sharp from 'sharp';
import { z } from 'zod';
import { adminBucket } from './firebase';
import { requireUser, requireWorkspace } from './auth';
import { ApiError, readJson } from './http';
import { GenerationStageError } from './content-generation-stream';
import { savedBrandPalette } from '../brand-visual-dna';
import { MAX_CONTENT_REFERENCES } from '../content-reference-options';
import { loadContentReferences } from './content-references';
import { isWorkspacePhoto, listWorkspacePhotos, persistWorkspacePhoto } from './brand-assets';
import type { GenerationProgress, GenerationStage } from '../content-generation';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { generateContentWithSavedAgent } from './content-agent';
import { generateSocialPostImage } from './content-image';
import { generateReelsVoiceover, REELS_VOICE_DISCLOSURE } from './reels-voice';
import { renderReelsVideo } from './reels-renderer';
import { buildRenderedVisualSvg } from '../veloxa-visual-renderer';
import { publicConnection } from './meta-oauth';
import { getMetaLoginProvider, type MetaConnection as StoredMetaConnection } from './meta-graph';
import { reserveGenerationAttempt, generationQuotaStatus } from './generation-policy';
import { wibMonth } from './clock';
import type { MetaConnection } from './meta-graph';
import type { BrandProfile, ContentDraft, SubscriptionPlanId } from '../veloxa-types';

export async function savePublicJpeg(workspaceId: string, section: 'renders' | 'vault', bytes: Buffer, bucket = adminBucket(), mimeType: 'image/jpeg' | 'video/mp4' = 'image/jpeg') {
  const path = `workspaces/${workspaceId}/${section}/${randomUUID()}.${mimeType === 'video/mp4' ? 'mp4' : 'jpg'}`;
  const token = randomUUID();
  await bucket.file(path).save(bytes, { resumable: false, metadata: { contentType: mimeType, cacheControl: 'private, max-age=3600', metadata: { firebaseStorageDownloadTokens: token } } });
  return { storagePath: path, url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${token}` };
}

async function savePublicMp4(workspaceId: string, bytes: Buffer, bucket = adminBucket()) {
  return savePublicJpeg(workspaceId, 'renders', bytes, bucket, 'video/mp4');
}

export async function uploadBrandPhoto(request: Request) {
  await requireUser(request);
  const size = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size < 1 || size > 9 * 1024 * 1024) throw new ApiError(413, 'Ukuran unggahan tidak valid atau melebihi 8 MB.');
  const body = await request.formData();
  const { ref, workspaceId, user } = await requireWorkspace(request, body.get('workspaceId'));
  const file = body.get('file');
  if (!(file instanceof File) || file.size < 1 || file.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new ApiError(400, 'Pilih gambar JPEG, PNG, atau WebP maksimal 8 MB.');
  let bytes: Buffer;
  try { bytes = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 30_000_000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(); }
  catch { throw new ApiError(400, 'Gambar tidak dapat dibaca. Gunakan file gambar yang valid.'); }
  const requestedTitle = z.string().trim().max(160).parse(body.get('title') || '');
  return persistWorkspacePhoto(ref, workspaceId, user.uid, bytes, requestedTitle || file.name.replace(/\.[^.]+$/, '').slice(0, 160));
}

const contentInput = z.object({ workspaceId: z.string(), topic: z.string().trim().min(1).max(1000), format: z.enum(['single_post', 'carousel', 'short_video']).default('single_post'), sourceAssetId: z.string().uuid().optional(), referenceAssetIds: z.array(z.string().uuid()).max(MAX_CONTENT_REFERENCES).refine(ids => new Set(ids).size === ids.length).optional(), referenceInstruction: z.string().trim().max(1000).optional() });

export async function createSocialContent(request: Request, dependencies: {
  authorize?: typeof requireWorkspace;
  storage?: ReturnType<typeof adminBucket>;
  generate?: typeof generateContentWithSavedAgent;
  renderImage?: typeof generateSocialPostImage;
  generateVoice?: typeof generateReelsVoiceover;
  renderVideo?: typeof renderReelsVideo;
  onProgress?: (progress: GenerationProgress) => void;
} = {}) {
  let stage: GenerationStage = 'validation';
  const progress = (next: GenerationStage) => { stage = next; dependencies.onProgress?.({ stage }); };
  try {
  progress('validation');
  const input = contentInput.parse(await readJson(request));
  if (input.sourceAssetId && input.referenceAssetIds?.length) throw new ApiError(400, 'Pilih salah satu jenis sumber visual.');
  if (input.format !== 'single_post' && input.sourceAssetId) throw new ApiError(400, 'Foto Brand Vault belum didukung untuk carousel dan Reels.');
  const { ref, workspaceId, workspace, user } = await (dependencies.authorize || requireWorkspace)(request, input.workspaceId);
  const snapshot = typeof workspace.snapshotJson === 'string' ? JSON.parse(workspace.snapshotJson) : null;
  const brand = snapshot?.brand as BrandProfile | undefined;
  if (!brand || brand.workspaceId !== workspaceId || !brand.businessName) throw new ApiError(409, 'Lengkapi Brand Brain workspace sebelum membuat konten.');
  let brandPalette:string[];
  try { brandPalette=savedBrandPalette(brand); } catch { throw new ApiError(409,'Periksa palet warna di Profil & aset, lalu simpan ulang.'); }
  const paletteParams=brandPalette.length?{brandPalette}:{};
  const businessContext={
    description:[`Bidang bisnis penyedia: ${businessCategoryLabel(brand.category)} (bukan bidang pelanggan).`,brand.businessDescription,...(Array.isArray(brand.offerings)?brand.offerings.slice(0,4).flatMap(item=>[item.title,item.highlight]):[])].filter((value):value is string=>typeof value==='string'&&!!value.trim()).join(' · ').slice(0,2500),
    audience:typeof brand.targetAudience==='string'?brand.targetAudience.slice(0,500):'',
    topic:input.topic,
  };
  const imageContextParams={businessContext};
  const selected = await ref.collection('private_meta_connections').get();
  const connections = selected.docs.map(doc => publicConnection(doc.data() as MetaConnection));
  if (!connections.some(connection => connection.connected)) throw new ApiError(409, 'Hubungkan Facebook Page atau Instagram terlebih dahulu.');
  const planId: SubscriptionPlanId = Object.hasOwn(SUBSCRIPTION_PLANS, String(workspace.subscriptionPlanId)) ? workspace.subscriptionPlanId as SubscriptionPlanId : 'free_trial';
  if (input.sourceAssetId) {
    const record = (await ref.collection('server_assets').doc(input.sourceAssetId).get()).data();
    if (!isWorkspacePhoto(record, workspaceId) || record.trashedAt) throw new ApiError(404, 'Foto tidak tersedia. Pilih foto lain atau pulihkan dari Sampah.');
  }
  if (input.referenceAssetIds?.length) progress('references');
  const references = await loadContentReferences(ref, workspaceId, input.referenceAssetIds || [], dependencies.storage);
  const referenceImageParams = references.length ? { referenceImages: references.map(item => item.bytes), referenceInstruction: input.referenceInstruction || input.topic } : {};
  if (references.length) progress('validation');
  // The trusted server policy can lift the daily cap; every attempt is still counted atomically.
  const generationQuota = await reserveGenerationAttempt(ref, workspaceId, planId);
  progress('script');
  const generated = await (dependencies.generate || generateContentWithSavedAgent)({ brand, format: input.format, source: 'manual_studio', customTopic: input.topic, vaultAssets: [], connections, planId, ...(references.length ? { referenceBrief: { titles: references.map(item => item.title), instruction: input.referenceInstruction || input.topic } } : {}) });
  const draft: ContentDraft = { ...generated.draft, id: `draft_${randomUUID()}`, status: generated.draft.qualityReview.passed ? 'approved' : 'draft' };
  if (references.length) { draft.usedRealAssetIds = references.map(item => item.id); draft.referenceInstruction = input.referenceInstruction || input.topic; }
  draft.publishTargets = selected.docs.map(doc => doc.data() as MetaConnection).filter(connection => draft.targetChannels.includes(connection.channel)).map(connection => ({ channel: connection.channel, accountId: connection.accountId, accountName: connection.accountName, handle: connection.handle }));
  let media: Awaited<ReturnType<typeof savePublicJpeg>>;
  let storagePaths: string[] | undefined;
  let videoStoragePath: string | undefined;
  if (input.format === 'short_video') {
    if (!draft.videoScenes || draft.videoScenes.length !== 4) throw new ApiError(502, 'Naskah Reels belum lengkap.', 'invalid_content_agent_response');
    const renderImage = dependencies.renderImage || generateSocialPostImage;
    progress('media');
    const results = await Promise.allSettled([
      Promise.allSettled(draft.videoScenes.map((scene, index) => renderImage({ businessName: brand.businessName, title: scene.textOverlay, hook: scene.voiceover, cta: index === 3 ? brand.defaultCta || 'Simpan tips ini' : `${index + 1}/4`, aspectRatio: '9:16', visualDirection: scene.visualDirection, ...imageContextParams, ...paletteParams, ...referenceImageParams }))).then(images => { if (images.some(image => image.status !== 'fulfilled')) throw new ApiError(502, 'Gambar Reels belum lengkap.', 'reels_media_unavailable'); return images.map(image => image.status === 'fulfilled' ? image.value : Buffer.alloc(0)); }),
      (dependencies.generateVoice || generateReelsVoiceover)(draft.videoScenes.map(scene => scene.voiceover).join(' ')),
    ] as const);
    if (results[0].status !== 'fulfilled') throw new GenerationStageError(new ApiError(502, 'Visual Reels belum dapat dibuat. Silakan coba lagi.', 'reels_media_unavailable'), 'images');
    if (results[1].status !== 'fulfilled') throw new GenerationStageError(new ApiError(502, 'Voiceover Reels belum dapat dibuat. Silakan coba lagi.', 'reels_media_unavailable'), 'voiceover');
    const voice = results[1].value;
    progress('rendering');
    const video = await (dependencies.renderVideo || renderReelsVideo)({ images: results[0].value, pcm: voice.pcm, sampleRate: voice.sampleRate, sceneWeights: draft.videoScenes.map(scene => scene.voiceover.trim().split(/\s+/).length) });
    progress('saving');
    media = await savePublicJpeg(workspaceId, 'renders', video.poster, dependencies.storage);
    const storedVideo = await savePublicMp4(workspaceId, video.mp4, dependencies.storage);
    videoStoragePath = storedVideo.storagePath;
    draft.renderedMedia = { url: media.url, mimeType: 'image/jpeg', width: video.width, height: video.height };
    draft.renderedVideo = { url: storedVideo.url, mimeType: 'video/mp4', width: video.width, height: video.height, durationSeconds: video.durationSeconds, voiceDisclosure: REELS_VOICE_DISCLOSURE };
    draft.videoDurationSeconds = video.durationSeconds;
    draft.voiceoverModel = voice.model;
    draft.caption = `${draft.caption}\n\n${REELS_VOICE_DISCLOSURE}`;
  } else if (input.format === 'carousel') {
    if (!draft.slides || draft.slides.length !== 5) throw new ApiError(502, 'Agen konten menghasilkan jumlah slide yang tidak valid. Silakan coba lagi.', 'invalid_content_agent_response');
    const renderImage = dependencies.renderImage || generateSocialPostImage;
    progress('images');
    const results = await Promise.allSettled(draft.slides.map(async (slide, index) => renderImage({
      businessName: brand.businessName,
      title: slide.headline,
      hook: slide.body,
      cta: index === 4 ? brand.defaultCta || 'Simpan' : `${index + 1}/5 · Geser untuk lanjut`,
      ...imageContextParams,
      ...paletteParams,
      ...referenceImageParams,
      visualDirection: slide.visualDirection,
    })));
    if (results.some(result => result.status === 'rejected')) throw new ApiError(502, 'Gambar carousel belum dapat dibuat. Silakan coba lagi.', 'carousel_image_unavailable');
    const slideBytes = results.map(result => result.status === 'fulfilled' ? result.value : Buffer.alloc(0));
    const slideMedia: Awaited<ReturnType<typeof savePublicJpeg>>[] = [];
    progress('saving');
    for (const bytes of slideBytes) slideMedia.push(await savePublicJpeg(workspaceId, 'renders', bytes, dependencies.storage));
    storagePaths = slideMedia.map(item => item.storagePath);
    draft.renderedSlides = slideMedia.map(item => ({ url: item.url, mimeType: 'image/jpeg', width: 1080, height: 1350 }));
    media = slideMedia[0];
    draft.renderedMedia = { url: media.url, mimeType: 'image/jpeg', width: 1080, height: 1350 };
  } else {
    progress('images');
    let bytes: Buffer;
    if (input.sourceAssetId) {
    const base = sharp(Buffer.from(buildRenderedVisualSvg({ brand, draft })), { limitInputPixels: 5_000_000 });
    const asset = (await ref.collection('server_assets').doc(input.sourceAssetId).get()).data();
    if (!isWorkspacePhoto(asset, workspaceId) || asset.trashedAt) throw new ApiError(404, 'Foto tidak tersedia. Pilih foto lain atau pulihkan dari Sampah.');
    const [source] = await (dependencies.storage || adminBucket()).file(asset.storagePath).download();
    const photo = await sharp(source, { limitInputPixels: 30_000_000 }).resize(888, 280, { fit: 'cover' }).toBuffer();
    base.composite([{ input: photo, left: 96, top: 220 }]);
    draft.usedRealAssetIds = [input.sourceAssetId];
    bytes = await base.jpeg({ quality: 92 }).toBuffer();
    } else {
      bytes = await (dependencies.renderImage || generateSocialPostImage)({
        businessName: brand.businessName,
        title: draft.title,
        hook: draft.hook,
        cta: brand.defaultCta || 'Selengkapnya',
        ...imageContextParams,
        ...paletteParams,
        ...referenceImageParams,
      });
    }
    progress('saving');
    media = await savePublicJpeg(workspaceId, 'renders', bytes, dependencies.storage);
    draft.renderedMedia = { url: media.url, mimeType: 'image/jpeg', width: 1080, height: 1350 };
  }
  const targetAccounts = Object.fromEntries(draft.publishTargets.map(target => [target.channel, target.accountId]));
  const targetProviders = Object.fromEntries(selected.docs.map(doc => doc.data() as StoredMetaConnection).filter(connection => draft.targetChannels.includes(connection.channel)).map(connection => [connection.channel, getMetaLoginProvider(connection.loginProvider)]));
  await ref.collection('social_drafts').doc(draft.id).create(JSON.parse(JSON.stringify({ draft, targetAccounts, targetProviders, storagePath: media.storagePath, ...(storagePaths ? { storagePaths } : {}), ...(videoStoragePath ? { videoStoragePath } : {}), createdBy: user.uid, createdAt: Date.now(), engineMode: generated.engineMode })));
  return { draft, engineMode: generated.engineMode, generationQuota };
  } catch (error) {
    if (error instanceof GenerationStageError) throw error;
    // Preserve input-validation HTTP semantics; all provider/storage failures are stage-scoped.
    if (stage === 'validation') throw error;
    throw new GenerationStageError(error, stage);
  }
}

export async function listSocialContent(request: Request, workspaceId: unknown) {
  const { ref, workspace, workspaceId: authorizedWorkspaceId } = await requireWorkspace(request, workspaceId);
  const docs = await ref.collection('social_drafts').orderBy('createdAt', 'desc').limit(50).get();
  const usage = await ref.collection('publish_usage').doc(wibMonth()).get();
  const planId: SubscriptionPlanId = Object.hasOwn(SUBSCRIPTION_PLANS, String(workspace.subscriptionPlanId)) ? workspace.subscriptionPlanId as SubscriptionPlanId : 'free_trial';
  const generationQuota = await generationQuotaStatus(ref, authorizedWorkspaceId, planId);
  return { drafts: docs.docs.map(doc => doc.data().draft as ContentDraft), quotaUsed: Number(usage.data()?.count || 0), generationQuota };
}

export async function listBrandPhotos(request: Request, workspaceId: unknown, includeTrash = false) {
  return listWorkspacePhotos(request, workspaceId, includeTrash);
}
