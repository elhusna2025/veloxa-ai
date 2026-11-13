import {randomUUID} from 'node:crypto';
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
import {GenerationStageError} from './content-generation-stream';
import {canRetryGeneration,recoveryTime} from './autonomy-recovery';
import {publishSocialContent} from './publishing';
import {publishMetaImage} from './meta-graph';
import {publishMetaCarousel} from './meta-carousel';
import {publishMetaReel} from './meta-reels';
import {SUBSCRIPTION_PLANS} from '../veloxa-engine';
import {effectiveWorkspacePlan} from '../subscription';
import {assertPublicationCapacity,readPublicationQuota} from './publication-quota';
import {runAutonomySchedulerTick} from './autonomy-scheduler';
import {sweepExpiredReelsCheckpoints} from './scheduled-reels-checkpoint';
import {assertNoAutonomyDispatch,createAutonomyDispatch,dispatchGuard,isDispatchFor,persistAutonomyReceipt,type AutonomyDispatchContext} from './autonomy-dispatch';
import {reconcileDueAutonomyPublications,recoverInterruptedPublication} from './autonomy-publication-reconcile';
type Database=ReturnType<typeof adminDb>;
type RuleRef=FirebaseFirestore.DocumentReference;
interface Dependencies{database?:Database;create?:typeof createSocialContent;publish?:typeof publishSocialContent;now?:()=>number}
/** One durable slot claim; only failures known to precede a save/send can be retried. */
export async function processAutonomyRule(ruleRef:RuleRef,deps:Dependencies={}){
 const db=deps.database||adminDb();const now=deps.now||Date.now;const initial=(await ruleRef.get()).data();if(!initial?.enabled)return{state:'inactive'};
 const started=now();
 const executionId=randomUUID();
 const newDraftKey=`draft_${randomUUID()}`;
 const reset={processingJob:null,processingRun:null,processingUntil:0};
 let jobRef:RuleRef|undefined;let revision=initial.revision;let claimed=false;let generating=false;
 let dispatchContext:AutonomyDispatchContext|undefined;
 try{
  const claim=await db.runTransaction(async tx=>{
   const raw=(await tx.get(ruleRef)).data();if(!raw?.enabled||raw.revision!==initial.revision)return null;
   if(raw.processingJob){
    if(raw.processingUntil>now())return null;
    const interrupted=ruleRef.collection('jobs').doc(raw.processingJob);
    const job=(await tx.get(interrupted)).data();
    if(raw.processingRun&&job?.state==='publishing'&&job.ruleRevision===raw.revision&&job.draftId===job.draftKey&&typeof job.draftId==='string'){
     const workspace=db.collection('workspaces').doc(raw.workspaceId);
     if(await recoverInterruptedPublication(tx,workspace,ruleRef,interrupted,raw,job,now()))return null;
    }
    // Only jobs with a fenced, atomic draft save are safe to recover after a worker crash.
    if(raw.processingRun&&job&&job.ruleRevision===raw.revision&&job.draftKey&&(job.state==='generating'||job.state==='prepared'&&job.draftId===job.draftKey)){
     const deadline=Math.min(job.scheduledAt+30*60_000,raw.nextSlotMs??Infinity);
     const prepared=job.state==='prepared';
     const recoveryKind=job.reelsArtworkRecovery?'reels_artwork':'generation';
     const retryAt=prepared?(now()<deadline?now():null):recoveryTime(recoveryKind,job.generationAttempts,job.scheduledAt,now(),raw.nextSlotMs);
     if(retryAt!==null){
      tx.update(interrupted,{state:prepared?'queued':'retry_generation',error:prepared?'':'Pembuatan konten terputus. Veloxa akan mencoba slot ini lagi.',retryAt:prepared?null:retryAt});
      tx.update(ruleRef,{...reset,pendingJob:interrupted.id,nextDueMs:retryAt});
     }else{
      tx.update(interrupted,{state:'failed',retryAt:null,finishedAt:now(),error:'Waktu pemulihan slot ini sudah habis. Periksa aktivitas untuk melihat hasilnya.'});
      tx.update(ruleRef,{...reset,pendingJob:null,nextDueMs:raw.nextSlotMs,...(raw.nextSlotMs===null?{enabled:false,revision:raw.revision+1,lastError:'Waktu pemulihan slot terakhir sudah habis.'}:{})});
     }
     return null;
    }
    tx.update(interrupted,{state:'needs_attention',error:'Proses terputus. Periksa Studio dan akun sosial sebelum mengulang.',finishedAt:now()});
    tx.update(ruleRef,{enabled:false,revision:raw.revision+1,lastError:'Proses sebelumnya terputus. Periksa aktivitas dan akun sosial sebelum mengaktifkan kembali.'});
    return null;
   }
   if(typeof raw.nextDueMs==='number'&&raw.nextDueMs>now())return null;
   const config=autonomyConfigSchema.parse(raw.config);const ref=db.collection('workspaces').doc(raw.workspaceId);await assertNoAutonomyDispatch(tx,ref);const ws=(await tx.get(ref)).data();if(!ws||ws.ownerUid!==raw.ownerUid)throw new ApiError(409,'Pemilik workspace berubah. Tinjau ulang aturan otomatis.');
   const {context}=await resolveBusinessContext(ref,ws,raw.businessId,tx);if(await profileFingerprint(context.brand)!==raw.profileFingerprint)throw new ApiError(409,'Profil bisnis berubah. Tinjau dan aktifkan kembali aturan dengan profil terbaru.');validateAutonomySource(config,context.brand);
   const accounts=readSocialAccounts((await tx.get(ref.collection('private_meta_connections'))).docs);if(config.connectionIds.some(id=>!context.connectionIds.includes(id)||!accounts.some(account=>account.connectionId===id&&(!account.expiresAt||account.expiresAt>now()))))throw new ApiError(409,'Akun tujuan berubah atau izinnya berakhir. Periksa akun sebelum melanjutkan.');
   const pending=typeof raw.pendingJob==='string'?raw.pendingJob:null;
   if(!pending&&raw.nextSlotMs===null){tx.update(ruleRef,{enabled:false,revision:raw.revision+1,nextDueMs:null});return null;}
   const slot=raw.nextSlotMs;
   if(!pending&&slot>now())return null;
   const id=pending||'slot_'+slot;
   const job=ruleRef.collection('jobs').doc(id);
   const previous=(await tx.get(job)).data();
   const future=nextConfiguredAutonomySlot(config,now());
   if(!pending&&!previous){
    const planId=effectiveWorkspacePlan(ws,now());
    const quota=await readPublicationQuota(ref,planId,tx,new Date(now()));
    try { assertPublicationCapacity(quota); }
    catch(error) {
     if(!(error instanceof ApiError)||error.code!=='daily_publication_quota_exhausted')throw error;
     tx.create(job,{state:'skipped',scheduledAt:slot,createdAt:now(),error:error.message});
     tx.update(ruleRef,{nextSlotMs:future,nextDueMs:future,...(future===null?{enabled:false,revision:raw.revision+1}:{})});
     return 'skipped' as const;
    }
    if(config.connectionIds.some(id=>!SUBSCRIPTION_PLANS[planId].allowedChannels.includes(accounts.find(account=>account.connectionId===id)!.channel)))throw new ApiError(403,'Kanal tujuan tidak tersedia dalam paket workspace.');
   }
   const retryGeneration=previous?.state==='retry_generation';
   const retryPublication=previous?.state==='retry_publication';
   if(pending){
    const validJob=!!previous&&previous.ruleRevision===raw.revision&&(retryGeneration?!previous.draftId&&Number.isSafeInteger(previous.contentSequence):(retryPublication||previous.state==='queued')&&!!previous.draftId);
    if(!validJob)throw new ApiError(409,'Antrean publikasi perlu diperiksa; tidak dikirim ulang otomatis.');
    if((retryGeneration||retryPublication)&&(now()>=previous!.scheduledAt+30*60_000||raw.nextSlotMs!==null&&now()>=raw.nextSlotMs)){
     tx.update(job,{state:'failed',retryAt:null,finishedAt:now(),error:'Waktu pemulihan slot ini sudah habis. Periksa aktivitas untuk melihat hasilnya.'});
     tx.update(ruleRef,{pendingJob:null,nextDueMs:raw.nextSlotMs,...(raw.nextSlotMs===null?{enabled:false,revision:raw.revision+1,lastError:'Waktu pemulihan slot terakhir sudah habis.'}:{})});
     return null;
    }
   }
   else if(previous)throw new ApiError(409,'Slot ini sudah pernah diproses. Periksa aktivitas sebelum mengulang.');
   const sequence=raw.sequence||0;
   const contentSequence=retryGeneration?previous!.contentSequence:sequence;
   const input=autonomyContentInput(config,context.brand,contentSequence,raw.recentTitles||[]);
   const explicitTopic=config.sourceMode==='topics'?config.topics[contentSequence%config.topics.length]:undefined;
   if(!pending&&now()-slot>30*60000){tx.create(job,{state:'skipped',scheduledAt:slot,createdAt:now(),error:'Slot terlewat lebih dari 30 menit; tidak menerbitkan konten susulan.'});tx.update(ruleRef,{nextSlotMs:future,nextDueMs:future,...(future===null?{enabled:false,revision:raw.revision+1}:{})});return null;}
   const generationAttempts=retryGeneration?(previous!.generationAttempts||1)+1:previous?.generationAttempts||1;
   const publicationAttempts=retryPublication?(previous!.publicationAttempts||1)+1:previous?.publicationAttempts||1;
   const scheduledAt=(previous?.scheduledAt??slot) as number;
   const draftKey=previous?.draftKey as string|undefined||newDraftKey;
   if(!pending)tx.create(job,{state:'generating',scheduledAt,createdAt:now(),ruleRevision:raw.revision,contentSequence:sequence,draftKey,generationAttempts,publicationAttempts,topic:input.topic,format:input.format});
   else tx.update(job,{state:retryGeneration?'generating':'publishing',retryAt:null,error:'',generationAttempts,publicationAttempts});
   const processingUntil=now()+6*60_000;
   tx.update(ruleRef,{processingJob:id,processingRun:executionId,processingUntil,pendingJob:null,nextDueMs:processingUntil,...(!pending?{nextSlotMs:future,sequence:sequence+1}:{})});
   const recoverScheduledReelsArtwork=retryGeneration&&input.format==='short_video'&&previous?.reelsArtworkRecovery
    ? (generationAttempts===2?'photo':'simplified') as 'photo'|'simplified' : undefined;
   return{raw,config,ref,job,input,draftKey,pendingDraft:previous?.draftId as string|undefined,retryPublication,publicationAttempts,scheduledAt,recoverScheduledReelsArtwork,explicitTopic};
  });
  if(claim==='skipped')return{state:'skipped'};
  if(!claim)return{state:'idle'};jobRef=claim.job;claimed=true;revision=claim.raw.revision;
  const checkActive=async(tx:FirebaseFirestore.Transaction)=>{const current=(await tx.get(ruleRef)).data();if(!current?.enabled||current.revision!==revision||current.processingJob!==claim.job.id||current.processingRun!==executionId||current.processingUntil<=now())throw new ApiError(409,'Aturan dijeda atau diubah. Publikasi otomatis dihentikan.');const ws=(await tx.get(claim.ref)).data();if(!ws||ws.ownerUid!==claim.raw.ownerUid)throw new ApiError(403,'Pemilik workspace berubah.');const {context}=await resolveBusinessContext(claim.ref,ws,claim.raw.businessId,tx);if(await profileFingerprint(context.brand)!==claim.raw.profileFingerprint)throw new ApiError(409,'Profil berubah saat proses berjalan. Tinjau draf sebelum terbit.');const accounts=readSocialAccounts((await tx.get(claim.ref.collection('private_meta_connections'))).docs);if(claim.config.connectionIds.some(id=>!context.connectionIds.includes(id)||!accounts.some(account=>account.connectionId===id&&(!account.expiresAt||account.expiresAt>now()))))throw new ApiError(409,'Akun tujuan berubah. Pengiriman dihentikan.');for(const assetId of new Set([...claim.config.referenceAssetIds,...(context.brand.logoAssetId?[context.brand.logoAssetId]:[])])){const asset=(await tx.get(claim.ref.collection('server_assets').doc(assetId))).data();if(!isWorkspacePhoto(asset,claim.ref.id)||asset.asset.id!==assetId||asset.trashedAt||assetBusiness(asset.asset)!==claim.raw.businessId)throw new ApiError(409,'Logo atau referensi berubah. Tinjau aset sebelum melanjutkan otomatis.');}return ws;};
  const assertActive=async()=>db.runTransaction(checkActive);
  const authorize:typeof requireWorkspace=async(_request,workspaceId)=>{if(workspaceId!==claim.ref.id)throw new ApiError(403,'Workspace tidak sesuai.');const workspace=await assertActive();return{workspace,ref:claim.ref,workspaceId:claim.ref.id,user:{uid:claim.raw.ownerUid} as DecodedIdToken};};
  let draftId=claim.pendingDraft;let title='';
  if(!draftId){
   generating=true;
   const result=await(deps.create||createSocialContent)(new Request('https://veloxa.internal/api',{method:'POST',body:JSON.stringify({...claim.input,expectedProfileFingerprint:claim.raw.profileFingerprint})}),{
    authorize,source:'autonomous_agent',scheduledRepairBudget:()=>started+235_000-now(),recoverScheduledReelsArtwork:claim.recoverScheduledReelsArtwork,
    scheduledExplicitTopic:claim.explicitTopic,
    scheduledDraft:{id:claim.draftKey,...(claim.input.format==='short_video'?{quotaJob:claim.job,scheduledAt:claim.scheduledAt}:{}),persist:async(draftRef,record)=>db.runTransaction(async tx=>{
     await checkActive(tx);
     tx.create(draftRef,record);
     tx.update(claim.job,{draftId:claim.draftKey,topic:record.draft.title,state:'prepared'});
    })},
   });
   generating=false;
   draftId=result.draft.id;title=result.draft.title;
   // Give a slow generation its own invocation rather than starting a send near the request deadline.
   if(now()-started>150_000){
    const queued=await db.runTransaction(async tx=>{
     const current=(await tx.get(ruleRef)).data();
     if(current?.processingJob!==claim.job.id||current.processingRun!==executionId)return false;
     const active=current.enabled&&current.revision===revision;
     tx.update(claim.job,{draftId,topic:title,...(active?{state:'queued'}:{state:'cancelled',finishedAt:now()})});
     tx.update(ruleRef,{...reset,...(active?{pendingJob:claim.job.id,nextDueMs:now()}:{})});
     return active;
    });
    return{state:queued?'queued':'cancelled',draftId};
   }
  }
  await db.runTransaction(async tx=>{
   await checkActive(tx);
   if(!claim.pendingDraft)tx.update(claim.job,{draftId,topic:title,state:'publishing'});
  });
  // Claim the durable dispatch fence atomically with activation/account checks.
  const dispatch={workspaceId:claim.ref.id,ruleId:ruleRef.id,jobId:claim.job.id,draftId,revision,run:executionId};
  dispatchContext=dispatch;
  const guardedFetch=createAutonomyDispatch(claim.ref,checkActive,fetch,()=>started+255_000-now(),dispatch);
  const result=await(deps.publish||publishSocialContent)(new Request('https://veloxa.internal/api',{method:'POST',body:JSON.stringify({workspaceId:claim.ref.id,draftId})}),{
   authorize,database:db,retryTransientFailures:claim.retryPublication,stopOnUnknown:true,autonomyRun:executionId,
   persistReceipt:(receipt,receipts,remaining)=>persistAutonomyReceipt(claim.ref,dispatch,receipt,receipts,remaining),
   publisher:params=>publishMetaImage(params,{fetcher:guardedFetch}),carouselPublisher:params=>publishMetaCarousel(params,{fetcher:guardedFetch}),reelPublisher:params=>publishMetaReel(params,{fetcher:guardedFetch}),
  });
  const outcome=result.hasMore?'queued':result.draft.status==='published'?'published':result.draft.status==='needs_attention'?'needs_attention':'failed';
  const state=await db.runTransaction(async tx=>{
   const current=(await tx.get(ruleRef)).data();
   if(current?.processingJob!==jobRef!.id||current.processingRun!==executionId)return outcome;
   const active=current.enabled&&current.revision===revision;
   const guard=outcome==='needs_attention'?(await tx.get(dispatchGuard(claim.ref))).data():undefined;
   const checking=isDispatchFor(guard,dispatch)&&['instagram_container','facebook_reel'].includes(guard?.kind);
   const transient=outcome==='failed'&&result.receipts.some(receipt=>receipt.status==='failed'&&receipt.retryable===true);
   const retryAt=active&&transient?recoveryTime('publication',claim.publicationAttempts,claim.scheduledAt,now(),current.nextSlotMs):null;
   const state=retryAt?'retry_publication':!active&&outcome==='queued'?'cancelled':outcome;
   const queued=state==='queued'||state==='retry_publication';
   const error=checking?'Veloxa sedang memeriksa hasil pengiriman sebelumnya.':
    state==='retry_publication'?'Gangguan sementara. Veloxa akan mencoba lagi hanya untuk akun yang belum menerima konten.':
    state==='needs_attention'||state==='failed'?'Publikasi belum lengkap. Periksa hasil per akun di aktivitas dan Studio.':'';
   tx.update(jobRef!,{state,draftId,receipts:JSON.parse(JSON.stringify(result.receipts)),retryAt,error,finishedAt:queued||checking?null:now()});
   if(!active){tx.update(ruleRef,reset);return state;}
   const hold=state==='needs_attention'||state==='failed'&&!transient;
   tx.update(ruleRef,{
    ...reset,
    pendingJob:queued?jobRef!.id:null,
    pendingReconciliation:checking?jobRef!.id:null,
    nextDueMs:retryAt??(queued?now()+60000:current.nextSlotMs),
    ...(!checking&&!queued&&(hold||current.nextSlotMs===null)?{enabled:false,revision:revision+1}:{}),
    lastError:!queued&&(hold||current.nextSlotMs===null)?error:'',
    ...(title?{recentTitles:[title,...(current.recentTitles||[])].slice(0,10)}:{}),
   });
   return state;
  });
  return{state,draftId};
 }catch(error){
  if(!claimed&&error instanceof ApiError&&error.code==='autonomy_dispatch_in_progress')return{state:'idle'};
  const message=error instanceof ApiError?error.message:'Proses otomatis belum selesai. Periksa draf dan akun sosial sebelum mengaktifkan kembali.';
  const recoverable=claimed&&generating&&canRetryGeneration(error);
  const failure=generating&&error instanceof GenerationStageError
   ? {generationFailure:{stage:error.stage,code:error.code}} : {};
  const state=claimed&&!recoverable?'needs_attention':'failed';
  // Saving the error is best effort. A failed write leaves the lease to stop unsafe retries.
  const resolved=await db.runTransaction(async tx=>{
   const current=(await tx.get(ruleRef)).data();
   if(!current)return state;
   const ownsJob=!!jobRef&&current.processingJob===jobRef.id&&current.processingRun===executionId;
   if((claimed||current.processingJob)&&!ownsJob)return state;
   if(current.revision!==revision){
    if(ownsJob){tx.update(jobRef!,{state:generating?'cancelled':state,error:message,finishedAt:now()});tx.update(ruleRef,reset);}
    return generating?'cancelled':state;
   }
   if(ownsJob&&error instanceof ApiError&&['daily_publication_quota_exhausted','daily_draft_quota_exhausted'].includes(error.code||'')){
    tx.update(jobRef!,{state:'skipped',error:message,retryAt:null,finishedAt:now()});
    tx.update(ruleRef,{...reset,pendingJob:null,nextDueMs:current.nextSlotMs,lastError:'',...(current.nextSlotMs===null?{enabled:false,revision:revision+1}:{})});
    return 'skipped';
   }
   if(dispatchContext&&ownsJob&&(!(error instanceof ApiError)||error.code==='delivery_unknown')){
    const slot=(await tx.get(jobRef!)).data();
    if(slot?.state==='publishing'&&slot.draftId===dispatchContext.draftId&&slot.draftKey===dispatchContext.draftId){
     const workspace=db.collection('workspaces').doc(dispatchContext.workspaceId);
     if(await recoverInterruptedPublication(tx,workspace,ruleRef,jobRef!,current,slot,now()))return state;
    }
   }
   if(recoverable&&ownsJob){
    const job=(await tx.get(jobRef!)).data()!;
    const reelsArtworkRecovery=job.format==='short_video'&&(job.reelsArtworkRecovery===true||failure.generationFailure?.code==='scheduled_artwork_rejected');
    const retryAt=recoveryTime(reelsArtworkRecovery?'reels_artwork':'generation',job.generationAttempts,job.scheduledAt,now(),current.nextSlotMs);
    const hasNextSlot=typeof current.nextSlotMs==='number';
    const nextState=retryAt?'retry_generation':'failed';
    const retryMessage='Veloxa sedang memulihkan visual Reels dan akan mencoba slot ini lagi.';
    tx.update(jobRef!,{state:nextState,error:reelsArtworkRecovery&&retryAt?retryMessage:message,retryAt,finishedAt:retryAt?null:now(),...failure,...(reelsArtworkRecovery?{reelsArtworkRecovery:true}:{})});
    tx.update(ruleRef,{
     ...reset,
     pendingJob:retryAt?jobRef!.id:null,
     nextDueMs:retryAt??(hasNextSlot?current.nextSlotMs:null),
     lastError:hasNextSlot||retryAt?'':message,
     ...(hasNextSlot||retryAt?{}:{enabled:false,revision:revision+1}),
    });
    return nextState;
   }
   const guard=dispatchContext&&ownsJob?(await tx.get(dispatchGuard(db.collection('workspaces').doc(dispatchContext.workspaceId)))).data():undefined;
   const checking=!!dispatchContext&&isDispatchFor(guard,dispatchContext)&&guard?.phase==='final'&&!!guard?.kind;
   if(jobRef&&ownsJob)tx.update(jobRef,{state,error:checking?'Veloxa sedang memeriksa hasil pengiriman sebelumnya.':message,finishedAt:checking?null:now(),...failure});
   else if(current.pendingJob){
    const pending=ruleRef.collection('jobs').doc(current.pendingJob);
    if((await tx.get(pending)).exists)tx.update(pending,{state:'failed',retryAt:null,error:message,finishedAt:now()});
   }
   tx.update(ruleRef,{
    ...reset,pendingJob:null,pendingReconciliation:checking?jobRef!.id:null,
    ...(checking?{nextDueMs:current.nextSlotMs,lastError:'Hasil pengiriman sedang dikonfirmasi.'}:{enabled:false,revision:revision+1,lastError:message}),
   });
   return state;
  }).catch(()=>'needs_attention');
  return{state:resolved,error:message};
 }
}
export async function tickAutonomy() {
 const db = adminDb();
 return runAutonomySchedulerTick({
  db,
  process: ref => processAutonomyRule(ref, { database: db }),
  reconcile: async (database, now) => {
   const [resolved] = await Promise.all([reconcileDueAutonomyPublications(database, now), sweepExpiredReelsCheckpoints(now)]);
   return resolved;
  },
 });
}
