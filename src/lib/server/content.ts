import { randomUUID } from 'node:crypto';
import { assetBusiness, assertBusinessTargets } from '../business-context';
import { resolveBusinessContext } from './business-contexts';
import { buildVisualBusinessContext } from '../content-business-context';
import { profileFingerprint } from '../profile-fingerprint';
import { carouselPlanSchema, validateCarouselPlan } from '../carousel-plan';
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
import { composeScheduledReelsCopy, composeSocialVisual, finishEditorialCarousel, preflightSocialVisualText, prepareScheduledReelsCopy, shortVisualCta, visualWebsite } from './content-compositor';
import { loadContentReferences } from './content-references';
import { isWorkspacePhoto, listWorkspacePhotos, persistWorkspacePhoto } from './brand-assets';
import type { GenerationProgress, GenerationStage } from '../content-generation';
import { effectiveWorkspacePlan } from '../subscription';
import { generateContentWithSavedAgent } from './content-agent';
import { generateSocialPostImage, scheduledArtworkCopy } from './content-image';
import { verifyScheduledArtwork } from './scheduled-artwork-review';
import { verifyScheduledScript } from './scheduled-script-review';
import { generateReelsVoiceover, REELS_VOICE_DISCLOSURE } from './reels-voice';
import { resolveAdminModels } from './admin-settings';
import { DEFAULT_CONTENT_MODELS } from '../admin-settings';
import { renderReelsVideo } from './reels-renderer';
import { scheduledReelsCheckpoint } from './scheduled-reels-checkpoint';
import { buildRenderedVisualSvg } from '../veloxa-visual-renderer';
import { publicConnection } from './meta-oauth';
import { readSocialAccounts, connectionIdSchema } from './social-accounts';
import { selectDraftAccounts, toAccountTarget } from './social-targets';
import { MAX_PUBLISH_ACCOUNTS } from '../social-account-identity';
import { getMetaLoginProvider, type MetaConnection as StoredMetaConnection } from './meta-graph';
import { reserveGenerationAttempt, generationQuotaStatus } from './generation-policy';
import { readPublicationQuota } from './publication-quota';
import type { MetaConnection } from './meta-graph';
import {parseAssetKind} from '../asset-kind';
import type { BrandProfile, ContentDraft } from '../veloxa-types';

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

export const contentInput = z.object({ operationId:z.string().uuid().optional(), sourceMode:z.enum(['manual','offerings']).optional(),offeringIds:z.array(z.string().min(1).max(180)).max(30).optional(),contentIntent:z.enum(['auto','education','introduction','promotion']).optional(), workspaceId: z.string(), businessId:z.string().optional(), selectedConnectionIds: z.array(connectionIdSchema).max(MAX_PUBLISH_ACCOUNTS).refine(ids => new Set(ids).size === ids.length).optional(), topic: z.string().trim().max(1000).default(''), expectedProfileFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), format: z.enum(['single_post', 'carousel', 'short_video']).default('single_post'), sourceAssetId: z.string().uuid().optional(), referenceAssetIds: z.array(z.string().uuid()).max(MAX_CONTENT_REFERENCES).refine(ids => new Set(ids).size === ids.length).optional(), referenceInstruction: z.string().trim().max(1000).optional(), referenceRoles:z.record(z.string().uuid(),z.enum(['visual','logo','screenshot'])).optional(), carouselPlan: carouselPlanSchema.optional() });

function fitScheduledReelsCaption(draft: ContentDraft, overflow: string[]) {
  const maxLength = 2_200;
  const join = (...parts: string[]) => parts.filter(Boolean).join('\n\n');
  const length = (value: string) => [...value].length;
  const original = join(draft.caption, ...overflow.filter(line => !draft.caption.includes(line)));
  if (length(join(original, REELS_VOICE_DISCLOSURE, draft.hashtags.join(' '))) <= maxLength) {
    draft.caption = original;
    return;
  }
  const reserved: string[] = [];
  for (const line of overflow) {
    if (length(join(...reserved, line, REELS_VOICE_DISCLOSURE)) <= maxLength) reserved.push(line);
  }
  const build = (body: string) => join(body, ...reserved.filter(line => !body.includes(line)));
  let body = draft.caption;
  if (length(join(build(body), REELS_VOICE_DISCLOSURE)) > maxLength) {
    body = '';
    for (const { segment } of new Intl.Segmenter('id', { granularity: 'sentence' }).segment(draft.caption)) {
      const next = (body + segment).trimEnd();
      if (length(join(build(next), REELS_VOICE_DISCLOSURE)) > maxLength) break;
      body += segment;
    }
    body = body.trim() || (length(join(build(draft.title), REELS_VOICE_DISCLOSURE)) <= maxLength ? draft.title : '');
  }
  draft.caption = build(body);
  const hashtags: string[] = [];
  for (const hashtag of draft.hashtags) {
    if (length(join(draft.caption, REELS_VOICE_DISCLOSURE, [...hashtags, hashtag].join(' '))) <= maxLength) hashtags.push(hashtag);
  }
  draft.hashtags = hashtags;
}

export async function createSocialContent(request: Request, dependencies: {
  authorize?: typeof requireWorkspace;
  storage?: ReturnType<typeof adminBucket>;
  generate?: typeof generateContentWithSavedAgent;
  renderImage?: typeof generateSocialPostImage;
  verifyArtwork?: typeof verifyScheduledArtwork;
  verifyScript?: typeof verifyScheduledScript;
  scheduledExplicitTopic?: string;
  scheduledRepairBudget?: () => number;
  recoverScheduledReelsArtwork?: 'photo' | 'simplified';
  scheduledDraft?: {
    id: string;
    quotaJob?: FirebaseFirestore.DocumentReference;
    scheduledAt?: number;
    persist: (ref: FirebaseFirestore.DocumentReference, record: FirebaseFirestore.DocumentData) => Promise<void>;
  };
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
  const carouselPlan = input.carouselPlan;
  if (carouselPlan) {
    if (input.format !== 'carousel' || dependencies.source === 'autonomous_agent' || !input.topic) {
      throw new ApiError(400, 'Rencana slide memerlukan topik dan format carousel di Studio.');
    }
    try {
      validateCarouselPlan(carouselPlan, input.referenceAssetIds || [], referenceRoles);
    } catch (error) {
      throw new ApiError(400, (error as Error).message);
    }
  }
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
  const planId = effectiveWorkspacePlan(workspace);
  const selectedAccounts=selectDraftAccounts(readSocialAccounts(selected.docs),input.selectedConnectionIds,planId);
  try{assertBusinessTargets(contexts,context.id,selectedAccounts.map(account=>account.connectionId),input.businessId===undefined&&contexts.length===1&&context.revision===0);}catch(error){throw new ApiError(409,error instanceof Error?error.message:'Akun tidak sesuai bisnis.','business_target_mismatch');}
  const connections=selectedAccounts.map(publicConnection);
  if (input.sourceAssetId) {
    const record = (await ref.collection('server_assets').doc(input.sourceAssetId).get()).data();
    if (!isWorkspacePhoto(record, workspaceId) || assetBusiness(record.asset)!==context.id || record.trashedAt) throw new ApiError(404, 'Foto tidak tersedia. Pilih foto lain atau pulihkan dari Sampah.');
  }
  if (input.referenceAssetIds?.length) progress('references');
  const references = await loadContentReferences(ref, workspaceId, input.referenceAssetIds || [], dependencies.storage,context.id);
  const carousel = input.format === 'carousel';
  const scheduledEditorial = dependencies.source === 'autonomous_agent';
  const editorialSinglePost = !scheduledEditorial && input.format === 'single_post' && !input.sourceAssetId;
  const labelReference = (item: typeof references[number]) => `Ref ${references.indexOf(item) + 1}: ${item.title}`;
  const visualReferences = references.filter(item => referenceRoles[item.id] === 'visual');
  const screenshotReferences = visualReferences.filter(item => item.category === 'screenshot');
  const originalAssets=references.filter(item=>referenceRoles[item.id]!=='visual').map(item=>({id:item.id,role:referenceRoles[item.id] as 'logo'|'screenshot',bytes:item.bytes}));
  if (scheduledEditorial && brand.logoAssetId && !references.some(item => item.id === brand.logoAssetId) && !originalAssets.some(asset => asset.role === 'logo')) {
    const [logo] = await loadContentReferences(ref, workspaceId, [brand.logoAssetId], dependencies.storage, context.id);
    originalAssets.push({ id: logo.id, role: 'logo', bytes: logo.bytes });
  }
  const referenceImageParams = references.length ? {
    ...(visualReferences.length ? { referenceImages: visualReferences.map(item => item.bytes), sceneReferenceLabels: visualReferences.map(labelReference) } : {}),
    referenceInstruction: input.referenceInstruction || topic,
  } : {};
  if (references.length) progress('validation');
  const scheduledDraft=scheduledEditorial?dependencies.scheduledDraft:undefined;
  const { scriptModel, imageModel, voiceModel } = await resolveAdminModels(ref.firestore, workspaceId);
  const reelModels = {
    ...(scriptModel && scriptModel !== DEFAULT_CONTENT_MODELS.scriptModel ? { scriptModel } : {}),
    ...(imageModel && imageModel !== DEFAULT_CONTENT_MODELS.imageModel ? { imageModel } : {}),
    ...(voiceModel && voiceModel !== DEFAULT_CONTENT_MODELS.voiceModel ? { voiceModel } : {}),
  };
  const reelsCheckpoint = input.format === 'short_video' && scheduledDraft?.quotaJob && scheduledDraft.scheduledAt !== undefined
    ? scheduledReelsCheckpoint(() => dependencies.storage || adminBucket(), workspaceId, scheduledDraft.id, scheduledDraft.scheduledAt, {
      input: { ...input, explicitTopic: dependencies.scheduledExplicitTopic, references: references.map(({ id, title, category }) => ({ id, title, category })) },
      fingerprint,
      images: [...visualReferences, ...originalAssets].map(item => item.bytes),
      ...(Object.keys(reelModels).length ? { models: reelModels } : {}),
    })
    : null;
  const generationQuota = await reserveGenerationAttempt(ref, workspaceId, planId, scheduledDraft?.quotaJob);
  progress('script');
  const cachedReelsScript = await reelsCheckpoint?.loadScript();
  const generated = cachedReelsScript ?? await (dependencies.generate || generateContentWithSavedAgent)({
    brand, format: input.format, source: dependencies.source || 'manual_studio', customTopic: topic,
    ...(source.focus ? { offeringFocus: source.focus } : {}),
    ...(carouselPlan ? { carouselPlan } : {}),
    vaultAssets: [], connections, planId,
    ...(references.length ? {
      referenceBrief: { titles: references.map(item => item.title), instruction: input.referenceInstruction || topic },
    } : {}),
  }, { model: scriptModel });
  if(scheduledEditorial&&!generated.draft.qualityReview.passed)throw new ApiError(422,'Naskah belum lolos pemeriksaan. Veloxa perlu menyusunnya ulang.','scheduled_script_rejected');
  const draft: ContentDraft = { ...generated.draft, id: scheduledDraft?.id??`draft_${randomUUID()}`, status: generated.draft.qualityReview.passed ? 'approved' : 'draft' };
  if (carouselPlan) {
    draft.slides = carouselPlan.map(({headline, body, visualDirection}, index) => ({
      headline, body, visualDirection, slideNumber: index + 1, badgeText: `${index + 1}/5`,
    }));
  }
  draft.referenceRoles=referenceRoles;
  if(source.metadata)draft.contentSource=source.metadata;
  if(input.businessId!==undefined||contexts.length>1||context.revision>0)draft.businessId=context.id;
  draft.profileContext={fingerprint,snapshotRevision:typeof workspace.snapshotRevision==='number'?workspace.snapshotRevision:0};
  if (references.length) {
    draft.usedRealAssetIds = references.filter(item => !carouselPlan || referenceRoles[item.id] !== 'visual' || carouselPlan.some(slide => slide.assetIds.includes(item.id))).map(item => item.id);
  }
  if (references.length || carouselPlan || (carousel && input.referenceInstruction)) draft.referenceInstruction = input.referenceInstruction || topic;
  const targetBindings=selectedAccounts.map(toAccountTarget);
  draft.publishTargets=targetBindings;
  draft.targetChannels=[...new Set(targetBindings.map(target=>target.channel))];
  draft.channelStatuses=targetBindings.map(target=>({...target,status:'pending'}));
  if(input.sourceAssetId){
    draft.visualText=[brand.businessName,brand.businessName.slice(0,2).toUpperCase(),brand.city,brand.defaultCta.slice(0,48),draft.slides?.[0]?.badgeText||'CAROUSEL · FEED 4:5'];
  }else{
    const ctas=carousel?[brand.defaultCta||'Simpan']:input.format==='short_video'?Array.from({length:4},(_,index)=>index===3?brand.defaultCta||'Simpan tips ini':scheduledEditorial?'':`${index+1}/4`).filter(Boolean):[brand.defaultCta||'Selengkapnya'];
    draft.visualText=[brand.businessName,visualWebsite(brand.websiteUrl),...ctas.map(shortVisualCta)];
  }
  if(forbiddenContentMatches(draft,brand.forbiddenWords).length)throw new GenerationStageError(new ApiError(409,'Teks visual memuat kata yang dihindari dalam profil bisnis. Periksa panduan konten dan CTA sebelum membuat ulang.','content_policy_violation'),'compositing');
  if (scheduledEditorial) {
    if (!cachedReelsScript) {
      await (dependencies.verifyScript || verifyScheduledScript)({ draft, brand, explicitTopic: dependencies.scheduledExplicitTopic });
    }
    draft.qualityReview = {
      ...draft.qualityReview,
      checkedAspects: { ...draft.qualityReview.checkedAspects, copyAccuracy: true },
    };
  }
  const reuseReelsMedia = !!cachedReelsScript || await reelsCheckpoint?.saveScript(generated);
  // Check the entire batch before any paid image or voice request starts. Captions and
  // Reels narration are not printed as body text and must not be judged by feed bounds.
  const visualPlan: Parameters<typeof generateSocialPostImage>[0][]=[];
  if(input.format==='short_video'){
    if(!draft.videoScenes||draft.videoScenes.length!==4)throw new ApiError(502,'Naskah Reels belum lengkap.','invalid_content_agent_response');
    visualPlan.push(...draft.videoScenes.map((scene,index)=>({businessName:brand.businessName,title:scene.textOverlay,hook:scene.voiceover,cta:index===3?brand.defaultCta||'Simpan tips ini':scheduledEditorial?'':`${index+1}/4`,aspectRatio:'9:16' as const,visualDirection:scene.visualDirection,...imageContextParams,...paletteParams,...referenceImageParams})));
  }else if(input.format==='carousel'){
    const slides = draft.slides;
    if (!slides || slides.length !== 5) throw new ApiError(502, 'Agen konten menghasilkan jumlah slide yang tidak valid. Silakan coba lagi.', 'invalid_content_agent_response');
    const brief = input.referenceInstruction || topic;
    const slideBriefs = new Map<number, string>();
    for (const match of brief.matchAll(/\bslide\s+(\d+)\s*[:.–-]?\s*([^]*?)(?=\bslide\s+\d+\b|$)/gi)) {
      slideBriefs.set(Number(match[1]), match[2].trim());
    }
    const refNumbers = (direction: string) => new Set(Array.from(direction.matchAll(/\bref\s*(\d+)\b/gi), match => Number(match[1])));
    visualPlan.push(...slides.map((slide, index) => {
      const plannedSlide = carouselPlan?.[index];
      let slideBrief = slideBriefs.get(index + 1) || '';
      let attached: typeof visualReferences;
      let screens: typeof screenshotReferences;
      if (plannedSlide) {
        attached = visualReferences.filter(item => plannedSlide.assetIds.includes(item.id));
        screens = attached.filter(item => item.category === 'screenshot');
        slideBrief = attached.length ? `Gunakan acuan visual pada slide ini: ${attached.map(labelReference).join('; ')}.` : '';
      } else {
        const requested = refNumbers(slideBrief);
        const mentioned = requested.size ? requested : refNumbers(slide.visualDirection);
        const matching = screenshotReferences.filter(item => mentioned.has(references.indexOf(item) + 1));
        screens = mentioned.size || !screenshotReferences.length
          ? matching
          : [screenshotReferences[index % screenshotReferences.length]];
        attached = visualReferences.filter(item => item.category !== 'screenshot' || screens.includes(item));
      }
      const finalSlide = index === slides.length - 1;
      const cta = finalSlide ? brand.defaultCta || 'Simpan' : '';
      return {
        businessName: brand.businessName,
        title: slide.headline,
        hook: slide.body,
        cta: shortVisualCta(cta),
        ...(finalSlide ? {website:visualWebsite(brand.websiteUrl)} : {}),
        ...(originalAssets.some(asset=>asset.role==='logo') ? {hasOriginalLogo:true} : {}),
        carouselSlide: true,
        hasOriginalScreenshot: originalAssets.some(asset => asset.role === 'screenshot'),
        visualDirection: slide.visualDirection,
        ...imageContextParams,
        ...paletteParams,
        ...(references.length || carouselPlan || input.referenceInstruction ? {
          referenceInstruction: brief,
          ...(slideBrief ? {slideReferenceDirection: slideBrief} : {}),
          ...(attached.length ? {referenceImages: attached.map(item => item.bytes),sceneReferenceLabels: attached.map(labelReference)} : {}),
          ...(screens.length ? {screenshotReferenceLabels: screens.map(labelReference)} : {}),
        } : {}),
      };
    }));
  }else if(!input.sourceAssetId){
    const cta = brand.defaultCta || 'Selengkapnya';
    visualPlan.push({
      businessName: brand.businessName, title: draft.title, hook: draft.hook,
      cta: editorialSinglePost ? shortVisualCta(cta) : cta,
      ...imageContextParams, ...paletteParams, ...referenceImageParams,
      ...(editorialSinglePost ? {
        editorialSinglePost: true,
        website: visualWebsite(brand.websiteUrl),
        hasOriginalLogo: originalAssets.some(asset => asset.role === 'logo'),
        hasOriginalScreenshot: originalAssets.some(asset => asset.role === 'screenshot'),
        ...(screenshotReferences.length ? { screenshotReferenceLabels: screenshotReferences.map(labelReference) } : {}),
      } : {}),
    });
  }
  if (!scheduledEditorial) {
    try{for(const params of visualPlan)await preflightSocialVisualText({...params,websiteUrl:brand.websiteUrl,originalAssets});}catch(error){throw new GenerationStageError(error,'compositing');}
  }
  const scheduledImageParams = (params: typeof visualPlan[number]) => ({
      ...params,
      scheduledEditorial: true,
      cta: shortVisualCta(params.cta),
      website: params.cta ? visualWebsite(brand.websiteUrl) : undefined,
      hasOriginalLogo: originalAssets.some(asset => asset.role === 'logo'),
      hasOriginalScreenshot: originalAssets.some(asset => asset.role === 'screenshot'),
  });
  const imageGenerator = dependencies.renderImage || generateSocialPostImage;
  const render: typeof generateSocialPostImage = (params, options) =>
    imageGenerator(params, imageModel ? { ...options, model: imageModel } : options);
  const verify = dependencies.verifyArtwork || verifyScheduledArtwork;
  const repairTimeout = async (error: unknown) => {
    const budget = dependencies.scheduledRepairBudget?.() ?? 90_000;
    if (!(error instanceof ApiError) || error.code !== 'scheduled_artwork_rejected' || budget < 45_000) throw error;
    await dependencies.authorize?.(request, workspaceId);
    return Math.min(90_000, budget - 22_000);
  };
  const scheduledReelsFrames = scheduledEditorial && input.format === 'short_video'
    ? await Promise.all(visualPlan.map(async (rawParams, sceneIndex) => {
      const params = scheduledImageParams(rawParams);
      const { fitted, captionLines } = await prepareScheduledReelsCopy(scheduledArtworkCopy(params), params.hasOriginalLogo);
      const scheduledReelsCopyBounds = Object.fromEntries(fitted.map(({ key, box }) => [key, box]));
      return {
        fitted, captionLines, sceneIndex,
        params: { ...params, scheduledReelsPhotoOnly: true, sceneOnly: true, scheduledReelsCopyBounds },
      };
    }))
    : null;
  if (scheduledReelsFrames) fitScheduledReelsCaption(draft, [...new Set(scheduledReelsFrames.flatMap(frame => frame.captionLines))]);
  const renderScheduledReels = async ({ params, fitted, sceneIndex }: NonNullable<typeof scheduledReelsFrames>[number]) => {
    const renderFrame = async (timeoutMs: number, simplifyFraming: boolean) => {
      const photo = await render({ ...params, scheduledArtworkRepair: simplifyFraming }, { timeoutMs });
      if (stage !== 'compositing') progress('compositing');
      try {
        const withText = await composeScheduledReelsCopy(photo, fitted);
        const master = await finishEditorialCarousel(withText, originalAssets, true);
        const output = await sharp(master).resize(720, 1280).jpeg({ quality: 94 }).toBuffer();
        await verify(output, params, photo);
        return output;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'scheduled_artwork_rejected') {
          console.warn(JSON.stringify({ event: 'scheduled_reels_scene_rejected', draftId: draft.id, scene: sceneIndex + 1, reason: error.message }));
        }
        throw new GenerationStageError(error, 'compositing');
      }
    };
    const budget = dependencies.scheduledRepairBudget?.() ?? 202_000;
    if (budget < 45_000) throw new ApiError(503, 'Waktu pemulihan visual Reels belum cukup.', 'scheduled_artwork_review_unavailable');
    try {
      return await renderFrame(Math.min(180_000, budget - 22_000), dependencies.recoverScheduledReelsArtwork === 'simplified');
    } catch (error) {
      return await renderFrame(await repairTimeout(error), true);
    }
  };
  const renderVisual: typeof generateSocialPostImage = async params => {
    if (scheduledEditorial) {
      const imageParams = scheduledImageParams(params);
      const renderAndReview = async (artworkParams: typeof imageParams, timeoutMs?: number) => {
        let scene: Buffer;
        try {
          scene = await render({ ...artworkParams, sceneOnly: false }, { timeoutMs });
        } catch (error) {
          throw new GenerationStageError(error, 'images');
        }
        if (stage !== 'compositing') progress('compositing');
        try {
          const composed = await finishEditorialCarousel(scene, originalAssets);
          await verify(composed, artworkParams, originalAssets.length ? scene : undefined);
          return composed;
        } catch (error) {
          throw new GenerationStageError(error, 'compositing');
        }
      };
      const budget = dependencies.scheduledRepairBudget?.();
      if (budget !== undefined && budget < 45_000) {
        throw new GenerationStageError(new ApiError(503, 'Waktu pemeriksaan visual belum cukup.', 'scheduled_artwork_review_unavailable'), 'images');
      }
      try {
        return await renderAndReview(imageParams, budget === undefined ? undefined : Math.min(180_000, budget - 22_000));
      } catch (error) {
        const timeoutMs = await repairTimeout(error);
        return await renderAndReview({ ...imageParams, scheduledArtworkRepair: true }, timeoutMs);
      }
    }

    const useEditorialArtwork = carousel || params.editorialSinglePost === true;
    const scene = await render({ ...params, sceneOnly: !useEditorialArtwork });
    if (stage !== 'compositing') progress('compositing');
    try {
      if (useEditorialArtwork) return await finishEditorialCarousel(scene, originalAssets);
      const composed = await composeSocialVisual(scene, { ...params, websiteUrl: brand.websiteUrl, originalAssets });
      return await sharp(composed).resize(params.aspectRatio === '9:16' ? 720 : 1080, params.aspectRatio === '9:16' ? 1280 : 1350).jpeg({ quality: 94 }).toBuffer();
    } catch (error) {
      throw new GenerationStageError(error, 'compositing');
    }
  };
  let media: Awaited<ReturnType<typeof savePublicJpeg>>;
  let storagePaths: string[] | undefined;
  let videoStoragePath: string | undefined;
  if (input.format === 'short_video') {
    if (!draft.videoScenes || draft.videoScenes.length !== 4) throw new ApiError(502, 'Naskah Reels belum lengkap.', 'invalid_content_agent_response');
    progress('media');
    const checkpoint = reuseReelsMedia ? reelsCheckpoint : null;
    const frames = scheduledReelsFrames ? scheduledReelsFrames.map((frame, index) => checkpoint
      ? checkpoint.frame(index, () => renderScheduledReels(frame)) : renderScheduledReels(frame)) : visualPlan.map(params => renderVisual(params));
    const generateVoice = () => (dependencies.generateVoice || generateReelsVoiceover)(
      draft.videoScenes!.map(scene => scene.voiceover).join(' '),
      { model: voiceModel },
    );
    const results = await Promise.allSettled([
      Promise.allSettled(frames).then(images => { const failed=images.find(image=>image.status==='rejected');if(failed?.status==='rejected')throw failed.reason; return images.map(image => image.status === 'fulfilled' ? image.value : Buffer.alloc(0)); }),
      checkpoint ? checkpoint.voice(generateVoice) : generateVoice(),
    ] as const);
    if(results[0].status==='rejected'&&results[0].reason instanceof GenerationStageError)throw results[0].reason;
    if (results[0].status !== 'fulfilled') throw new GenerationStageError(new ApiError(502, 'Visual Reels belum dapat dibuat. Silakan coba lagi.', 'reels_media_unavailable'), 'images');
    if (results[1].status !== 'fulfilled') throw new GenerationStageError(new ApiError(502, 'Voiceover Reels belum dapat dibuat. Silakan coba lagi.', 'reels_media_unavailable'), 'voiceover');
    const voice = results[1].value;
    progress('rendering');
    const video = await (dependencies.renderVideo || renderReelsVideo)({
      images: results[0].value, pcm: voice.pcm, sampleRate: voice.sampleRate,
      sceneWeights: draft.videoScenes.map(scene => scene.voiceover.trim().split(/\s+/).length),
      useReviewedFrames: scheduledEditorial,
    });
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
    const results = await Promise.allSettled(visualPlan.map(params=>renderImage(params)));
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
      bytes = await renderVisual(visualPlan[0]);
    }
    progress('saving');
    media = await savePublicJpeg(workspaceId, 'renders', bytes, dependencies.storage);
    draft.renderedMedia = { url: media.url, mimeType: 'image/jpeg', width: 1080, height: 1350 };
  }
  const targetAccounts = Object.fromEntries(draft.publishTargets.map(target => [target.channel, target.accountId]));
  const targetProviders = Object.fromEntries(selected.docs.map(doc => doc.data() as StoredMetaConnection).filter(connection => draft.targetChannels.includes(connection.channel)).map(connection => [connection.channel, getMetaLoginProvider(connection.loginProvider)]));
  const draftRef=ref.collection('social_drafts').doc(draft.id);
  const record=JSON.parse(JSON.stringify({ draft, targetBindings, targetAccounts, targetProviders, storagePath: media.storagePath, ...(storagePaths ? { storagePaths } : {}), ...(videoStoragePath ? { videoStoragePath } : {}), createdBy: user.uid, createdAt: Date.now(),...(input.operationId?{operationId:input.operationId}:{}), engineMode: generated.engineMode, profileFingerprint:fingerprint, snapshotRevision:draft.profileContext.snapshotRevision, forbiddenWordsAtGeneration:brand.forbiddenWords }));
  if(scheduledDraft)await scheduledDraft.persist(draftRef,record);
  else await draftRef.create(record);
  if (reuseReelsMedia) await reelsCheckpoint?.remove();
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
  const planId = effectiveWorkspacePlan(workspace);
  const [docs, publicationQuota, generationQuota] = await Promise.all([
    ref.collection('social_drafts').orderBy('createdAt', 'desc').limit(50).get(),
    readPublicationQuota(ref, planId),
    generationQuotaStatus(ref, authorizedWorkspaceId, planId),
  ]);
  return { drafts: docs.docs.map(doc => doc.data().draft as ContentDraft), planId, quotaUsed: publicationQuota.used, publicationQuota, generationQuota };
}

export async function listBrandPhotos(request: Request, workspaceId: unknown, includeTrash = false,selectedBusiness:unknown='primary') {
  return listWorkspacePhotos(request, workspaceId, includeTrash,{},selectedBusiness);
}
