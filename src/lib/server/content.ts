import { randomUUID } from 'node:crypto';
import { assetBusiness, assertBusinessTargets } from '../business-context';
import { resolveBusinessContext } from './business-contexts';
import { buildVisualBusinessContext } from '../content-business-context';
import { profileFingerprint } from '../profile-fingerprint';
import { resolveContentSource } from '../content-source';
import sharp from 'sharp';
import { z } from 'zod';
import { adminBucket } from './firebase';
import { requireUser, requireWorkspace } from './auth';
import { ApiError, readJson } from './http';
import { GenerationStageError } from './content-generation-stream';
import { savedBrandPalette } from '../brand-visual-dna';
import { MAX_CONTENT_REFERENCES } from '../content-reference-options';
import { resolveReferenceRoles } from '../content-reference-roles';
import { forbiddenContentMatches } from '../content-policy';
import { composeSocialVisual, shortVisualCta, visualWebsite } from './content-compositor';
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
import { readSocialAccounts, connectionIdSchema } from './social-accounts';
import { selectDraftAccounts, toAccountTarget } from './social-targets';
import { MAX_PUBLISH_ACCOUNTS } from '../social-account-identity';
import { getMetaLoginProvider, type MetaConnection as StoredMetaConnection } from './meta-graph';
import { reserveGenerationAttempt, generationQuotaStatus } from './generation-policy';
import { wibMonth } from './clock';
import type { MetaConnection } from './meta-graph';
import {parseAssetKind} from '../asset-kind';
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
  const { ref, workspaceId, user, workspace } = await requireWorkspace(request, body.get('workspaceId'));
  const {context}=await resolveBusinessContext(ref,workspace,body.get('businessId'));
  const file = body.get('file');
  if (!(file instanceof File) || file.size < 1 || file.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new ApiError(400, 'Pilih gambar JPEG, PNG, atau WebP maksimal 8 MB.');
  let bytes: Buffer;
  try { bytes = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 30_000_000 }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer(); }
  catch { throw new ApiError(400, 'Gambar tidak dapat dibaca. Gunakan file gambar yang valid.'); }
  let kind;try{if(body.get('category'))kind=parseAssetKind({category:body.get('category'),customCategoryLabel:body.get('customCategoryLabel')||''});}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Jenis aset tidak valid.');}
  const requestedTitle = z.string().trim().max(160).parse(body.get('title') || '');
  return persistWorkspacePhoto(ref, workspaceId, user.uid, bytes, requestedTitle || file.name.replace(/\.[^.]+$/, '').slice(0, 160),undefined,context.id,kind);
}

export const contentInput = z.object({ operationId:z.string().uuid().optional(), sourceMode:z.enum(['manual','offerings']).optional(),offeringIds:z.array(z.string().min(1).max(180)).max(30).optional(),contentIntent:z.enum(['auto','education','introduction','promotion']).optional(), workspaceId: z.string(), businessId:z.string().optional(), selectedConnectionIds: z.array(connectionIdSchema).max(MAX_PUBLISH_ACCOUNTS).refine(ids => new Set(ids).size === ids.length).optional(), topic: z.string().trim().max(1000).default(''), expectedProfileFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), format: z.enum(['single_post', 'carousel', 'short_video']).default('single_post'), sourceAssetId: z.string().uuid().optional(), referenceAssetIds: z.array(z.string().uuid()).max(MAX_CONTENT_REFERENCES).refine(ids => new Set(ids).size === ids.length).optional(), referenceInstruction: z.string().trim().max(1000).optional(), referenceRoles:z.record(z.string().uuid(),z.enum(['visual','logo','screenshot'])).optional() });

export async function createSocialContent(request: Request, dependencies: {
  authorize?: typeof requireWorkspace;
  storage?: ReturnType<typeof adminBucket>;
  generate?: typeof generateContentWithSavedAgent;
  renderImage?: typeof generateSocialPostImage;
  generateVoice?: typeof generateReelsVoiceover;
  renderVideo?: typeof renderReelsVideo;
  onProgress?: (progress: GenerationProgress) => void;
  source?:'autonomous_agent';
} = {}) {
  let stage: GenerationStage = 'validation';
  const progress = (next: GenerationStage) => { stage = next; dependencies.onProgress?.({ stage }); };
  try {
  progress('validation');
  const input = contentInput.parse(await readJson(request));
  let referenceRoles;try{referenceRoles=resolveReferenceRoles(input.referenceAssetIds||[],input.referenceRoles);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Peran referensi tidak valid.');}
  if (input.sourceAssetId && input.referenceAssetIds?.length) throw new ApiError(400, 'Pilih salah satu jenis sumber visual.');
  if (input.format !== 'single_post' && input.sourceAssetId) throw new ApiError(400, 'Foto Brand Vault belum didukung untuk carousel dan Reels.');
  const { ref, workspaceId, workspace, user } = await (dependencies.authorize || requireWorkspace)(request, input.workspaceId);
  const {contexts,context}=await resolveBusinessContext(ref,workspace,input.businessId);
  const savedBrand=context.brand;
  if (!savedBrand || savedBrand.workspaceId !== workspaceId || !savedBrand.businessName) throw new ApiError(409, 'Lengkapi Brand Brain workspace sebelum membuat konten.');
  const fingerprint=await profileFingerprint(savedBrand);
  if(input.expectedProfileFingerprint!==fingerprint)throw new ApiError(409,'Profil bisnis telah berubah di tab atau perangkat lain. Isian topik tetap ada. Muat ulang profil sebelum membuat draf.','profile_conflict');
  let source;try{source=resolveContentSource(savedBrand,input);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Pilihan produk tidak valid.','invalid_offering_selection');}
  const {brand,topic}=source;
  let brandPalette:string[];
  try { brandPalette=savedBrandPalette(brand); } catch { throw new ApiError(409,'Periksa palet warna di Profil & aset, lalu simpan ulang.'); }
  const paletteParams=brandPalette.length?{brandPalette}:{};
  let businessContext;
  try { businessContext=buildVisualBusinessContext(brand,topic); } catch(error){throw new ApiError(409,error instanceof Error?error.message:'Periksa profil bisnis.','profile_context_invalid');}
  const imageContextParams={businessContext};
  const selected = await ref.collection('private_meta_connections').get();
  const planId: SubscriptionPlanId = Object.hasOwn(SUBSCRIPTION_PLANS, String(workspace.subscriptionPlanId)) ? workspace.subscriptionPlanId as SubscriptionPlanId : 'free_trial';
  const selectedAccounts=selectDraftAccounts(readSocialAccounts(selected.docs),input.selectedConnectionIds,planId);
  try{assertBusinessTargets(contexts,context.id,selectedAccounts.map(account=>account.connectionId),input.businessId===undefined&&contexts.length===1&&context.revision===0);}catch(error){throw new ApiError(409,error instanceof Error?error.message:'Akun tidak sesuai bisnis.','business_target_mismatch');}
  const connections=selectedAccounts.map(publicConnection);
  if (input.sourceAssetId) {
    const record = (await ref.collection('server_assets').doc(input.sourceAssetId).get()).data();
    if (!isWorkspacePhoto(record, workspaceId) || assetBusiness(record.asset)!==context.id || record.trashedAt) throw new ApiError(404, 'Foto tidak tersedia. Pilih foto lain atau pulihkan dari Sampah.');
  }
  if (input.referenceAssetIds?.length) progress('references');
  const references = await loadContentReferences(ref, workspaceId, input.referenceAssetIds || [], dependencies.storage,context.id);
  const visualReferences=references.filter(item=>referenceRoles[item.id]==='visual');
  const originalAssets=references.filter(item=>referenceRoles[item.id]!=='visual').map(item=>({id:item.id,role:referenceRoles[item.id] as 'logo'|'screenshot',bytes:item.bytes}));
  const referenceImageParams = references.length ? { ...(visualReferences.length?{referenceImages:visualReferences.map(item=>item.bytes),sceneReferenceLabels:visualReferences.map(item=>`Ref ${references.indexOf(item)+1}: ${item.title}`)}:{}), referenceInstruction: input.referenceInstruction || topic } : {};
  if (references.length) progress('validation');
  // The trusted server policy can lift the daily cap; every attempt is still counted atomically.
  const generationQuota = await reserveGenerationAttempt(ref, workspaceId, planId);
  progress('script');
  const generated = await (dependencies.generate || generateContentWithSavedAgent)({ brand, format: input.format, source: dependencies.source || 'manual_studio', customTopic: topic, ...(source.focus?{offeringFocus:source.focus}:{}), vaultAssets: [], connections, planId, ...(references.length ? { referenceBrief: { titles: references.map(item => item.title), instruction: input.referenceInstruction || topic } } : {}) });
  const draft: ContentDraft = { ...generated.draft, id: `draft_${randomUUID()}`, status: generated.draft.qualityReview.passed ? 'approved' : 'draft' };
  draft.referenceRoles=referenceRoles;
  if(source.metadata)draft.contentSource=source.metadata;
  if(input.businessId!==undefined||contexts.length>1||context.revision>0)draft.businessId=context.id;
  draft.profileContext={fingerprint,snapshotRevision:typeof workspace.snapshotRevision==='number'?workspace.snapshotRevision:0};
  if (references.length) { draft.usedRealAssetIds = references.map(item => item.id); draft.referenceInstruction = input.referenceInstruction || topic; }
  const targetBindings=selectedAccounts.map(toAccountTarget);
  draft.publishTargets=targetBindings;
  draft.targetChannels=[...new Set(targetBindings.map(target=>target.channel))];
  draft.channelStatuses=targetBindings.map(target=>({...target,status:'pending'}));
  if(input.sourceAssetId){
    draft.visualText=[brand.businessName,brand.businessName.slice(0,2).toUpperCase(),brand.city,brand.defaultCta.slice(0,48),draft.slides?.[0]?.badgeText||'CAROUSEL · FEED 4:5'];
  }else{
    const ctas=input.format==='carousel'?Array.from({length:5},(_,index)=>index===4?brand.defaultCta||'Simpan':`${index+1}/5 · Geser untuk lanjut`):input.format==='short_video'?Array.from({length:4},(_,index)=>index===3?brand.defaultCta||'Simpan tips ini':`${index+1}/4`):[brand.defaultCta||'Selengkapnya'];
    draft.visualText=[brand.businessName,visualWebsite(brand.websiteUrl),...ctas.map(shortVisualCta)];
  }
  if(forbiddenContentMatches(draft,brand.forbiddenWords).length)throw new GenerationStageError(new ApiError(409,'Teks visual memuat kata yang dihindari dalam profil bisnis. Periksa panduan konten dan CTA sebelum membuat ulang.','content_policy_violation'),'compositing');
  const renderVisual:typeof generateSocialPostImage=async params=>{
    const scene=await(dependencies.renderImage||generateSocialPostImage)({...params,sceneOnly:true});
    if(stage!=='compositing')progress('compositing');
    let composed:Buffer;try{composed=await composeSocialVisual(scene,{...params,websiteUrl:brand.websiteUrl,originalAssets});}catch(error){throw new GenerationStageError(error,'compositing');}
    return sharp(composed).resize(params.aspectRatio==='9:16'?720:1080,params.aspectRatio==='9:16'?1280:1350).jpeg({quality:94}).toBuffer();
  };
  let media: Awaited<ReturnType<typeof savePublicJpeg>>;
  let storagePaths: string[] | undefined;
  let videoStoragePath: string | undefined;
  if (input.format === 'short_video') {
    if (!draft.videoScenes || draft.videoScenes.length !== 4) throw new ApiError(502, 'Naskah Reels belum lengkap.', 'invalid_content_agent_response');
    const renderImage = renderVisual;
    progress('media');
    const results = await Promise.allSettled([
      Promise.allSettled(draft.videoScenes.map((scene, index) => renderImage({ businessName: brand.businessName, title: scene.textOverlay, hook: scene.voiceover, cta: index === 3 ? brand.defaultCta || 'Simpan tips ini' : `${index + 1}/4`, aspectRatio: '9:16', visualDirection: scene.visualDirection, ...imageContextParams, ...paletteParams, ...referenceImageParams }))).then(images => { const failed=images.find(image=>image.status==='rejected');if(failed?.status==='rejected')throw failed.reason; return images.map(image => image.status === 'fulfilled' ? image.value : Buffer.alloc(0)); }),
      (dependencies.generateVoice || generateReelsVoiceover)(draft.videoScenes.map(scene => scene.voiceover).join(' ')),
    ] as const);
    if(results[0].status==='rejected'&&results[0].reason instanceof GenerationStageError)throw results[0].reason;
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
    const renderImage = renderVisual;
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
    const failed=results.find(result=>result.status==='rejected');
    if(failed?.status==='rejected'){if(failed.reason instanceof GenerationStageError)throw failed.reason;throw new GenerationStageError(new ApiError(502,'Gambar carousel belum dapat dibuat. Silakan coba lagi.','carousel_image_unavailable'),'images');}
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
      bytes = await renderVisual({
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
  await ref.collection('social_drafts').doc(draft.id).create(JSON.parse(JSON.stringify({ draft, targetBindings, targetAccounts, targetProviders, storagePath: media.storagePath, ...(storagePaths ? { storagePaths } : {}), ...(videoStoragePath ? { videoStoragePath } : {}), createdBy: user.uid, createdAt: Date.now(),...(input.operationId?{operationId:input.operationId}:{}), engineMode: generated.engineMode, profileFingerprint:fingerprint, snapshotRevision:draft.profileContext.snapshotRevision, forbiddenWordsAtGeneration:brand.forbiddenWords })));
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

export async function listBrandPhotos(request: Request, workspaceId: unknown, includeTrash = false,selectedBusiness:unknown='primary') {
  return listWorkspacePhotos(request, workspaceId, includeTrash,{},selectedBusiness);
}
