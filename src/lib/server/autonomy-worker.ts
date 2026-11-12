import type {DecodedIdToken} from 'firebase-admin/auth';
import {adminDb} from './firebase';
import type {requireWorkspace} from './auth';
import {ApiError} from './http';
import {isWorkspacePhoto} from './brand-assets';
import {assetBusiness} from '../business-context';
import {resolveBusinessContext} from './business-contexts';
import {profileFingerprint} from '../profile-fingerprint';
import {autonomyConfigSchema,autonomyContentInput,nextConfiguredAutonomySlot,validateAutonomySource} from '../autonomy-rules';
import {readSocialAccounts} from './social-accounts';
import {createSocialContent} from './content';
import {publishSocialContent} from './publishing';
import {publishMetaImage} from './meta-graph';
import {publishMetaCarousel} from './meta-carousel';
import {publishMetaReel} from './meta-reels';
import {SUBSCRIPTION_PLANS} from '../veloxa-engine';
import {wibMonth} from './clock';
import {ruleCollection} from './autonomy-api';
import {assertNoAutonomyDispatch,createAutonomyDispatch} from './autonomy-dispatch';
type Database=ReturnType<typeof adminDb>;
type RuleRef=FirebaseFirestore.DocumentReference;
interface Dependencies{database?:Database;create?:typeof createSocialContent;publish?:typeof publishSocialContent;now?:()=>number}
/** Single durable slot claim; ambiguous generation/send is held, never blindly retried. */
export async function processAutonomyRule(ruleRef:RuleRef,deps:Dependencies={}){
 const db=deps.database||adminDb();const now=deps.now||Date.now;const initial=(await ruleRef.get()).data();if(!initial?.enabled)return{state:'inactive'};
 let jobRef:RuleRef|undefined;let revision=initial.revision;let claimed=false;
 try{
  const claim=await db.runTransaction(async tx=>{
   const raw=(await tx.get(ruleRef)).data();if(!raw?.enabled||raw.revision!==initial.revision)return null;
   if(raw.processingJob){if(raw.processingUntil>now())return null;tx.update(ruleRef.collection('jobs').doc(raw.processingJob),{state:'needs_attention',error:'Proses terputus. Periksa Studio dan akun sosial sebelum mengulang.',finishedAt:now()});tx.update(ruleRef,{enabled:false,revision:raw.revision+1,lastError:'Proses sebelumnya terputus. Periksa aktivitas dan akun sosial sebelum mengaktifkan kembali.'});return null;}
   const config=autonomyConfigSchema.parse(raw.config);const ref=db.collection('workspaces').doc(raw.workspaceId);await assertNoAutonomyDispatch(tx,ref);const ws=(await tx.get(ref)).data();if(!ws||ws.ownerUid!==raw.ownerUid)throw new ApiError(409,'Pemilik workspace berubah. Tinjau ulang aturan otomatis.');
   const {context}=await resolveBusinessContext(ref,ws,raw.businessId,tx);if(await profileFingerprint(context.brand)!==raw.profileFingerprint)throw new ApiError(409,'Profil bisnis berubah. Tinjau dan aktifkan kembali aturan dengan profil terbaru.');validateAutonomySource(config,context.brand);
   const accounts=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);if(config.connectionIds.some(id=>!context.connectionIds.includes(id)||!accounts.some(account=>account.connectionId===id&&(!account.expiresAt||account.expiresAt>now()))))throw new ApiError(409,'Akun tujuan berubah atau izinnya berakhir. Periksa akun sebelum melanjutkan.');
   const pending=typeof raw.pendingJob==='string'?raw.pendingJob:null;
   if(!pending&&raw.nextSlotMs===null){tx.update(ruleRef,{enabled:false,revision:raw.revision+1,nextDueMs:null});return null;}
   if(!pending){const plan=SUBSCRIPTION_PLANS[Object.hasOwn(SUBSCRIPTION_PLANS,String(ws.subscriptionPlanId))?ws.subscriptionPlanId as keyof typeof SUBSCRIPTION_PLANS:'free_trial'];const used=Number((await tx.get(ref.collection('publish_usage').doc(wibMonth()))).data()?.count||0);if(!Number.isSafeInteger(used)||used<0||used>=plan.monthlyPostQuota)throw new ApiError(429,'Kuota publikasi bulan ini habis. Aturan dijeda sebelum membuat konten.');if(config.connectionIds.some(id=>!plan.allowedChannels.includes(accounts.find(account=>account.connectionId===id)!.channel)))throw new ApiError(403,'Kanal tujuan tidak tersedia dalam paket workspace.');}const slot=raw.nextSlotMs;if(!pending&&slot>now())return null;const id=pending||'slot_'+slot;const job=ruleRef.collection('jobs').doc(id);const previous=(await tx.get(job)).data();
   if(pending){if(!previous?.draftId||previous.state!=='queued'||previous.ruleRevision!==raw.revision)throw new ApiError(409,'Antrean publikasi perlu diperiksa; tidak dikirim ulang otomatis.');}
   else if(previous)throw new ApiError(409,'Slot ini sudah pernah diproses. Periksa aktivitas sebelum mengulang.');
   const sequence=raw.sequence||0;const input=autonomyContentInput(config,context.brand,sequence,raw.recentTitles||[]);const future=nextConfiguredAutonomySlot(config,now());
   if(!pending&&now()-slot>30*60000){tx.create(job,{state:'skipped',scheduledAt:slot,createdAt:now(),error:'Slot terlewat lebih dari 30 menit; tidak menerbitkan konten susulan.'});tx.update(ruleRef,{nextSlotMs:future,nextDueMs:future,...(future===null?{enabled:false,revision:raw.revision+1}:{})});return null;}
   if(!pending)tx.create(job,{state:'generating',scheduledAt:slot,createdAt:now(),ruleRevision:raw.revision,topic:input.topic,format:input.format});else tx.update(job,{state:'publishing'});
   tx.update(ruleRef,{processingJob:id,processingUntil:now()+15*60000,pendingJob:null,...(!pending?{nextSlotMs:future,nextDueMs:now()+15*60000,sequence:sequence+1}:{})});
   return{raw,config,ref,job,input,pendingDraft:previous?.draftId as string|undefined};
  });
  if(!claim)return{state:'idle'};jobRef=claim.job;claimed=true;revision=claim.raw.revision;
  const checkActive=async(tx:FirebaseFirestore.Transaction)=>{const current=(await tx.get(ruleRef)).data();if(!current?.enabled||current.revision!==revision||current.processingJob!==claim.job.id)throw new ApiError(409,'Aturan dijeda atau diubah. Publikasi otomatis dihentikan.');const ws=(await tx.get(claim.ref)).data();if(!ws||ws.ownerUid!==claim.raw.ownerUid)throw new ApiError(403,'Pemilik workspace berubah.');const {context}=await resolveBusinessContext(claim.ref,ws,claim.raw.businessId,tx);if(await profileFingerprint(context.brand)!==claim.raw.profileFingerprint)throw new ApiError(409,'Profil berubah saat proses berjalan. Tinjau draf sebelum terbit.');const accounts=readSocialAccounts((await tx.get(claim.ref.collection('private_meta_connections'))).docs);if(claim.config.connectionIds.some(id=>!context.connectionIds.includes(id)||!accounts.some(account=>account.connectionId===id&&(!account.expiresAt||account.expiresAt>now()))))throw new ApiError(409,'Akun tujuan berubah. Pengiriman dihentikan.');for(const assetId of new Set([...claim.config.referenceAssetIds,...(context.brand.logoAssetId?[context.brand.logoAssetId]:[])])){const asset=(await tx.get(claim.ref.collection('server_assets').doc(assetId))).data();if(!isWorkspacePhoto(asset,claim.ref.id)||asset.asset.id!==assetId||asset.trashedAt||assetBusiness(asset.asset)!==claim.raw.businessId)throw new ApiError(409,'Logo atau referensi berubah. Tinjau aset sebelum melanjutkan otomatis.');}return ws;};
  const assertActive=async()=>db.runTransaction(checkActive);
  const authorize:typeof requireWorkspace=async(_request,workspaceId)=>{if(workspaceId!==claim.ref.id)throw new ApiError(403,'Workspace tidak sesuai.');const workspace=await assertActive();return{workspace,ref:claim.ref,workspaceId:claim.ref.id,user:{uid:claim.raw.ownerUid} as DecodedIdToken};};
  let draftId=claim.pendingDraft;let title='';
  if(!draftId){const result=await(deps.create||createSocialContent)(new Request('https://veloxa.internal/api',{method:'POST',body:JSON.stringify({...claim.input,expectedProfileFingerprint:claim.raw.profileFingerprint})}),{authorize,source:'autonomous_agent'});draftId=result.draft.id;title=result.draft.title;await jobRef.update({draftId,topic:title,state:'publishing'});}
  await assertActive();
  // Claim the durable dispatch fence atomically with activation/account checks.
  const guardedFetch=createAutonomyDispatch(claim.ref,checkActive);
  const result=await(deps.publish||publishSocialContent)(new Request('https://veloxa.internal/api',{method:'POST',body:JSON.stringify({workspaceId:claim.ref.id,draftId})}),{authorize,database:db,publisher:params=>publishMetaImage(params,{fetcher:guardedFetch}),carouselPublisher:params=>publishMetaCarousel(params,{fetcher:guardedFetch}),reelPublisher:params=>publishMetaReel(params,{fetcher:guardedFetch})});
  const state=result.hasMore?'queued':result.draft.status==='published'?'published':result.draft.status==='needs_attention'?'needs_attention':'failed';
  await db.runTransaction(async tx=>{
   const current=(await tx.get(ruleRef)).data();
   tx.update(jobRef!,{state,draftId,receipts:JSON.parse(JSON.stringify(result.receipts)),finishedAt:now()});
   if(current?.processingJob!==jobRef!.id)return;
   const reset={processingJob:null,processingUntil:0};
   if(current.revision!==revision){tx.update(ruleRef,reset);return;}
   const queued=state==='queued';
   const failed=state==='failed'||state==='needs_attention';
   tx.update(ruleRef,{
    ...reset,
    pendingJob:queued?jobRef!.id:null,
    nextDueMs:queued?now()+60000:current.nextSlotMs,
    ...(!queued&&(failed||current.nextSlotMs===null)?{enabled:false,revision:revision+1}:{}),
    ...(failed?{lastError:'Publikasi belum lengkap. Periksa hasil per akun di aktivitas dan Studio.'}:{}),
    ...(title?{recentTitles:[title,...(current.recentTitles||[])].slice(0,10)}:{}),
   });
  });
  return{state,draftId};
 }catch(error){
  const message=error instanceof ApiError?error.message:'Proses otomatis belum selesai. Periksa draf dan akun sosial sebelum mengaktifkan kembali.';
  // Saving the error is best effort. A failed write leaves the lease to stop unsafe retries.
  await db.runTransaction(async tx=>{const current=(await tx.get(ruleRef)).data();if(jobRef)tx.set(jobRef,{state:claimed?'needs_attention':'failed',error:message,finishedAt:now()},{merge:true});if(jobRef&&current?.processingJob===jobRef.id&&current?.revision!==revision)tx.update(ruleRef,{processingJob:null,processingUntil:0});if(current?.revision===revision)tx.update(ruleRef,{enabled:false,revision:revision+1,processingJob:null,processingUntil:0,pendingJob:null,lastError:message});}).catch(()=>{});
  return{state:'needs_attention',error:message};
 }
}
export async function tickAutonomy(){
 const db=adminDb();
 const due=await ruleCollection().where('enabled','==',true).where('nextDueMs','<=',Date.now()).orderBy('nextDueMs','asc').limit(1).get();
 await db.collection('system_operations').doc('organic_scheduler').set({at:Date.now()});
 if(due.empty)return{state:'idle',processed:0};const result=await processAutonomyRule(due.docs[0].ref);return{...result,processed:1};
}
