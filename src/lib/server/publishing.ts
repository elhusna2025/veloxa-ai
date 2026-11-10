import { z } from 'zod';
import { forbiddenContentMatches } from '../content-policy';
import { assertBusinessTargets, draftBusiness } from '../business-context';
import { resolveBusinessContext } from './business-contexts';
import { adminBucket, adminDb } from './firebase';
import { hasWorkspaceAccess, requireWorkspace } from './auth';
import { ApiError, readJson } from './http';
import { isVerifiedAdmin } from '../veloxa-workspace-policy';
import { wibMonth } from './clock';
import { decryptMetaToken } from './meta-crypto';
import { MetaRequestError, publishMetaImage, getMetaLoginProvider, type MetaConnection, type MetaChannel } from './meta-graph';
import { publishMetaCarousel } from './meta-carousel';
import { publishMetaReel } from './meta-reels';
import { REELS_VOICE_DISCLOSURE } from './reels-voice';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { readSocialAccounts, type StoredAccount } from './social-accounts';
import { storedAccountTargets, assertTargetBinding } from './social-targets';
import type { ContentDraft, SubscriptionPlanId } from '../veloxa-types';

export interface PublishReceipt {
  connectionId?: string;
  accountId?: string;
  accountName?: string;
  handle?: string;
  channel: MetaChannel;
  status: 'published' | 'failed' | 'unknown';
  externalPostId?: string;
  permalink?: string;
  error?: string;
  publishedAt?: string;
}
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const publishInput = z.object({ workspaceId: z.string(), draftId: z.string().regex(/^draft_[a-zA-Z0-9_-]+$/) }).strict();

export function publicationState(receipts: PublishReceipt[]): ContentDraft['status'] {
  if (receipts.length && receipts.every(receipt => receipt.status === 'published')) return 'published';
  if (receipts.some(receipt => receipt.status === 'unknown')) return 'needs_attention';
  return receipts.some(receipt => receipt.status === 'published') ? 'partially_published' : 'publish_failed';
}

export async function publishSocialContent(request: Request, dependencies: {
  authorize?: typeof requireWorkspace;
  database?: ReturnType<typeof adminDb>;
  storage?: ReturnType<typeof adminBucket>;
  publisher?: typeof publishMetaImage;
  carouselPublisher?: typeof publishMetaCarousel;
  reelPublisher?: typeof publishMetaReel;
  decrypt?: typeof decryptMetaToken;
  now?:()=>number;
} = {}) {
  const input = publishInput.parse(await readJson(request));
  const { ref, user } = await (dependencies.authorize || requireWorkspace)(request, input.workspaceId);
  const db = dependencies.database || adminDb();
  const draftRef = ref.collection('social_drafts').doc(input.draftId);
  const jobRef = ref.collection('publish_jobs').doc(input.draftId);
  const month = wibMonth();
  const usageRef = ref.collection('publish_usage').doc(month);
  const stored = (await draftRef.get()).data();
  const draft = stored?.draft as ContentDraft | undefined;
  const validMedia = draft?.format === 'single_post'
    ? !!draft.renderedMedia && typeof stored?.storagePath === 'string' && stored.storagePath.startsWith(`workspaces/${ref.id}/renders/`)
    : draft?.format === 'short_video'
      ? !!draft.renderedVideo && draft.renderedVideo.mimeType === 'video/mp4' && draft.renderedVideo.width === 720 && draft.renderedVideo.height === 1280
        && Number.isFinite(draft.renderedVideo.durationSeconds) && draft.renderedVideo.durationSeconds >= 19.85 && draft.renderedVideo.durationSeconds <= 30.15
        && draft.renderedVideo.voiceDisclosure === REELS_VOICE_DISCLOSURE && draft.caption.includes(REELS_VOICE_DISCLOSURE)
        && typeof stored?.videoStoragePath === 'string' && stored.videoStoragePath.startsWith(`workspaces/${ref.id}/renders/`) && stored.videoStoragePath.endsWith('.mp4')
        && (() => { try { return new URL(draft.renderedVideo.url).protocol === 'https:'; } catch { return false; } })()
      : draft?.format === 'carousel' && Array.isArray(draft.renderedSlides) && draft.renderedSlides.length === 5
      && Array.isArray(stored?.storagePaths) && stored.storagePaths.length === 5
      && stored.storagePaths.every((path: unknown) => typeof path === 'string' && path.startsWith(`workspaces/${ref.id}/renders/`))
      && draft.renderedSlides.every(slide => {
        if (!slide || slide.mimeType !== 'image/jpeg' || slide.width !== 1080 || slide.height !== 1350 || typeof slide.url !== 'string') return false;
        try { return new URL(slide.url).protocol === 'https:'; } catch { return false; }
      });
  if (!stored || !draft || draft.workspaceId !== ref.id || !validMedia) throw new ApiError(409, 'Buat media final post tunggal, carousel, atau Reels di Studio Veloxa sebelum menerbitkan.');
  if (!draft.qualityReview.passed) throw new ApiError(409, 'Konten belum lolos pemeriksaan teks. Perbaiki draf terlebih dahulu.');
  const caption = [draft.caption, draft.hashtags.join(' ')].filter(Boolean).join('\n\n');
  if ([...caption].length > 2200) throw new ApiError(400, 'Caption dan hashtag melebihi 2.200 karakter.');
  const targets=storedAccountTargets(stored,draft);

  const claim = await db.runTransaction(async tx => {
    const [jobSnap, usageSnap, wsSnap] = await tx.getAll(jobRef, usageRef, ref);
    const accounts=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);
    const job = jobSnap.data();
    const workspace = wsSnap.data();
    if (!workspace || !hasWorkspaceAccess(user.uid, workspace, isVerifiedAdmin(user))) throw new ApiError(403, 'Akses workspace telah berubah.');
    if (job?.state === 'processing' || job?.state === 'needs_attention') throw new ApiError(409, 'Publikasi sedang diproses atau hasilnya perlu diperiksa di akun Meta. Jangan kirim ulang.', 'delivery_in_progress');
    const receipts = ((job?.receipts || []) as PublishReceipt[]).map(receipt=>{
      const matches=targets.filter(target=>receipt.connectionId?target.connectionId===receipt.connectionId:target.channel===receipt.channel);
      if(matches.length!==1)throw new ApiError(409,'Riwayat publikasi perlu diperiksa sebelum mengirim ulang.','delivery_unknown');
      return {...receipt,connectionId:matches[0].connectionId,accountId:matches[0].accountId,accountName:matches[0].accountName,handle:matches[0].handle};
    });
    if (job?.state === 'published') return { alreadyPublished: true, receipts };
    const {contexts,context}=await resolveBusinessContext(ref,workspace,draftBusiness(draft),tx);
    const currentWords:unknown=context.brand.forbiddenWords;
    const generatedWords=stored.forbiddenWordsAtGeneration??[];
    if(!Array.isArray(currentWords)||!Array.isArray(generatedWords)||[...currentWords,...generatedWords].some(word=>typeof word!=='string'))throw new ApiError(409,'Daftar kata yang dihindari belum valid. Periksa profil bisnis.');
    if(forbiddenContentMatches(draft,[...currentWords,...generatedWords]).length)throw new ApiError(409,'Konten memuat kata yang dihindari dalam profil bisnis. Perbaiki atau buat draf baru sebelum menerbitkan.','content_policy_violation');
    const remainingTargets:string[]=job?.state==='queued' ? z.array(z.string()).max(50).parse(job.remainingTargets) : targets.filter(target=>!receipts.some(receipt=>receipt.connectionId===target.connectionId&&receipt.status==='published')).map(target=>target.connectionId);
    if(new Set(remainingTargets).size!==remainingTargets.length||remainingTargets.some(id=>!targets.some(target=>target.connectionId===id)))throw new ApiError(409,'Antrean tujuan publikasi tidak valid.','delivery_unknown');
    for(const target of targets){
      // Continuations record an unavailable destination as its own failure in the loop below.
      // A single disconnected account must not hold the remaining approved queue hostage.
      if(job?.state==='queued')continue;
      if(receipts.some(receipt=>receipt.connectionId===target.connectionId&&receipt.status==='published'))continue;
      assertTargetBinding(accounts.find(account=>account.connectionId===target.connectionId),target);
      try{assertBusinessTargets(contexts,context.id,[target.connectionId],!draft.businessId&&contexts.length===1&&context.revision===0);}catch(error){throw new ApiError(409,error instanceof Error?error.message:'Akun tidak sesuai bisnis.','business_target_mismatch');}
    }
    const planId = Object.hasOwn(SUBSCRIPTION_PLANS, String(workspace.subscriptionPlanId)) ? workspace.subscriptionPlanId as SubscriptionPlanId : 'free_trial';
    const plan = SUBSCRIPTION_PLANS[planId];
    if (targets.some(target => !plan.allowedChannels.includes(target.channel))) throw new ApiError(403, 'Kanal tidak termasuk dalam paket workspace.');
    let reservedMonth = job?.reservedMonth || month;
    if (!job?.quotaReserved) {
      const used = Number(usageSnap.data()?.count || 0);
      if (!Number.isSafeInteger(used) || used < 0 || used >= plan.monthlyPostQuota) throw new ApiError(429, 'Kuota publikasi bulan ini habis.', 'quota_exhausted');
      tx.set(usageRef, { count: used + 1 }, { merge: true });
      tx.update(ref, { quotaUsed: used + 1 });
      reservedMonth = month;
    }
    tx.set(jobRef, { state: 'processing', receipts, remainingTargets, quotaReserved: true, reservedMonth, startedAt: Date.now(), requestedBy: user.uid }, { merge: true });
    tx.update(draftRef, { 'draft.status': 'publishing' });
    return { alreadyPublished: false, receipts, remainingTargets };
  });
  if (claim.alreadyPublished) return { draft: { ...draft, status: 'published' }, receipts: claim.receipts, quotaUsed: Number((await usageRef.get()).data()?.count || 0) };

  const receipts:PublishReceipt[] = [...claim.receipts];
  const remainingTargets=[...(claim.remainingTargets||[])];
  const now=dependencies.now||Date.now;const batchStarted=now();let processed=0;
  // Every successful remote send is persisted before moving to the next channel.
  // A lost response or a worker crash blocks automatic retry rather than risking duplicate posts.
  for (const target of targets.filter(target=>remainingTargets.includes(target.connectionId))) {
    // Bound each request; the client resumes the persisted queue without resending receipts.
    if(processed>=3||(processed>0&&now()-batchStarted>=60_000))break;
    processed++;
    const channel=target.channel;
    if (receipts.some(receipt => receipt.connectionId === target.connectionId && receipt.status === 'published')) continue;
    const previous = receipts.findIndex(receipt => receipt.connectionId === target.connectionId);
    if (previous >= 0) receipts.splice(previous, 1);
    let receipt: PublishReceipt;
    let dispatched = false;
    let connection: StoredAccount | undefined;
    try {
      connection=readSocialAccounts((await ref.collection('private_meta_connections').get()).docs).find(account=>account.connectionId===target.connectionId);
      assertTargetBinding(connection,target);
      const loginProvider=target.loginProvider;
      const storage = dependencies.storage || adminBucket();
      const mediaBytes = draft.format === 'carousel'
        ? await Promise.all(stored.storagePaths.map(async (path: string) => (await storage.file(path).download())[0]))
        : [(await storage.file(draft.format === 'short_video' ? stored.videoStoragePath : stored.storagePath).download())[0]];
      // Media loading may take time: honor a disconnect/provider change immediately before dispatch.
      connection=readSocialAccounts((await ref.collection('private_meta_connections').get()).docs).find(account=>account.connectionId===target.connectionId);
      assertTargetBinding(connection,target);
      const latestWorkspace=(await ref.get()).data();
      if(!latestWorkspace||!hasWorkspaceAccess(user.uid,latestWorkspace,isVerifiedAdmin(user)))throw new ApiError(403,'Akses workspace telah berubah.');
      const business=await resolveBusinessContext(ref,latestWorkspace,draftBusiness(draft));
      try{assertBusinessTargets(business.contexts,business.context.id,[target.connectionId],!draft.businessId&&business.contexts.length===1&&business.context.revision===0);}catch(error){throw new ApiError(409,error instanceof Error?error.message:'Akun telah dipindahkan ke bisnis lain.','business_target_mismatch');}
      if(forbiddenContentMatches(draft,[...business.context.brand.forbiddenWords,...(stored.forbiddenWordsAtGeneration||[])]).length)throw new ApiError(409,'Konten tidak sesuai panduan bisnis terbaru.','content_policy_violation');
      const token = (dependencies.decrypt || decryptMetaToken)(connection!.encryptedToken, ref.id);
      dispatched = true;
      const result = draft.format === 'short_video'
        ? await (dependencies.reelPublisher || publishMetaReel)({ channel, loginProvider, accountId: connection!.accountId, token, videoUrl: draft.renderedVideo!.url, videoBytes: mediaBytes[0], caption })
        : draft.format === 'carousel'
        ? await (dependencies.carouselPublisher || publishMetaCarousel)({ channel, loginProvider, accountId: connection!.accountId, token, images: draft.renderedSlides!.map((slide, index) => ({ imageUrl: slide.url, imageBytes: mediaBytes[index] })), caption })
        : await (dependencies.publisher || publishMetaImage)({ channel, loginProvider, accountId: connection!.accountId, token, imageUrl: draft.renderedMedia!.url, imageBytes: mediaBytes[0], caption });
      receipt = { channel, status: 'published', ...result, publishedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof MetaRequestError && [10, 190, 200].includes(error.providerCode || 0) && connection) {
        await ref.collection('private_meta_connections').doc(connection.storageId).update({ expiresAt: Date.now() - 1 }).catch(() => undefined);
        await ref.collection('connections').doc(connection.storageId).update({ connected: false, oauthMode: 'pending_review' }).catch(() => undefined);
      }
      receipt = { channel, status: error instanceof MetaRequestError && error.uncertain ? 'unknown' : error instanceof ApiError || !dispatched ? 'failed' : 'unknown', error: error instanceof ApiError ? error.message : dispatched ? 'Hasil publikasi belum dapat dipastikan. Periksa akun sebelum mencoba ulang.' : 'Media atau koneksi belum dapat dibaca. Belum ada konten dikirim ke kanal ini.' };
    }
    receipt={...receipt,connectionId:target.connectionId,accountId:target.accountId,accountName:target.accountName,handle:target.handle};
    receipts.push(clean(receipt));
    remainingTargets.splice(remainingTargets.indexOf(target.connectionId),1);
    try { await jobRef.update({ receipts, remainingTargets }); }
    catch { throw new ApiError(409, 'Hasil kirim belum tersimpan. Periksa akun Meta sebelum mencoba ulang.', 'delivery_unknown'); }
    if (receipt.status === 'published') {
      await ref.collection('private_meta_connections').doc(connection!.storageId).update({ lastPublishedAt: receipt.publishedAt }).catch(() => undefined);
      await ref.collection('connections').doc(connection!.storageId).update({ lastPublishedAt: receipt.publishedAt }).catch(() => undefined);
    }
  }
  const hasMore=remainingTargets.length>0&&!receipts.some(receipt=>receipt.status==='unknown');
  const state:ContentDraft['status']=receipts.some(receipt=>receipt.status==='unknown')?'needs_attention':hasMore?'publish_queued':publicationState(receipts);
  const updated: ContentDraft = clean({ ...draft, status: state, publishedAtWib: state === 'published' ? new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : undefined,
    channelStatuses: targets.map(target=>{const receipt=receipts.find(item=>item.connectionId===target.connectionId);return {...target,status:receipt?.status||'pending',permalink:receipt?.permalink,publishedAt:receipt?.publishedAt,note:receipt?.error};}) });
  await db.runTransaction(async tx => {
    const job = (await tx.get(jobRef)).data()!;
    const reservedRef = ref.collection('publish_usage').doc(job.reservedMonth);
    const usage = (await tx.get(reservedRef)).data();
    // Definitive failure on every channel releases the reservation; unknown delivery keeps it.
    if (state === 'publish_failed' && job.quotaReserved) {
      const count = Math.max(0, Number(usage?.count || 0) - 1);
      tx.set(reservedRef, { count }, { merge: true });
      if (job.reservedMonth === month) tx.update(ref, { quotaUsed: count });
      tx.update(jobRef, { quotaReserved: false });
    }
    tx.update(jobRef, { state:hasMore?'queued':state, remainingTargets, completedAt:hasMore?null:Date.now() });
    tx.update(draftRef, { draft: updated });
  });
  return { draft: updated, receipts, hasMore, pendingAccounts:remainingTargets.length, quotaUsed: Number((await usageRef.get()).data()?.count || 0) };
}
