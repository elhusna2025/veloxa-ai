import {draftBusiness} from '../business-context';
import type {ContentDraft} from '../veloxa-types';
import {workspaceIdSchema} from './auth';
import {dispatchGuard,isDispatchFor,publicationReconciliationCollection,type AutonomyDispatchContext,type DispatchEvidence} from './autonomy-dispatch';
import {wibMonth} from './clock';
import {decryptMetaToken} from './meta-crypto';
import {isPublishedFacebookReel} from './meta-reels';
import {draftPublicationResult,publicationState,type PublishReceipt} from './publishing';
import {readSocialAccounts,socialConnectionId} from './social-accounts';
import {storedAccountTargets,type AccountTarget} from './social-targets';

type Ref=FirebaseFirestore.DocumentReference;
type Tx=FirebaseFirestore.Transaction;
type Data=FirebaseFirestore.DocumentData;
type Database=FirebaseFirestore.Firestore;
type LookupDependencies={fetcher?:typeof fetch;decrypt?:typeof decryptMetaToken};
type Proof=Pick<PublishReceipt,'externalPostId'|'permalink'|'providerContainerId'>;
const retryDelay=60_000;
const postId=/^\d{1,128}(?:_\d{1,128})?$/;
const documentId=/^[a-zA-Z0-9_-]{1,160}$/;
const processingReset={processingJob:null,processingRun:null,processingUntil:0};

function targetReceipts(raw:unknown,targets:AccountTarget[]):PublishReceipt[]|null{
 if(!Array.isArray(raw))return null;
 const receipts:PublishReceipt[]=[];
 for(const item of raw){
  if(!item||!['published','failed','unknown'].includes(item.status))return null;
  const matches=targets.filter(target=>target.channel===item.channel&&target.connectionId===item.connectionId&&target.accountId===item.accountId);
  if(matches.length!==1||receipts.some(receipt=>receipt.connectionId===item.connectionId))return null;
  if(item.status==='published'&&!item.externalPostId&&!item.providerContainerId)return null;
  receipts.push(item);
 }
 return receipts;
}

function frozenTargets(stored:Data|undefined,workspaceId:string,draftId:string,businessId:string){
 const draft=stored?.draft as ContentDraft|undefined;
 if(!stored||!draft||draft.id!==draftId||draft.workspaceId!==workspaceId||draftBusiness(draft)!==businessId)return null;
 try{return{draft,targets:storedAccountTargets(stored,draft)};}catch{return null;}
}

function canResumeSlot(job:Data,rule:Data,now:number){
 return Number.isFinite(job.scheduledAt)&&now<job.scheduledAt+30*60_000&&(rule.nextSlotMs===null||now<rule.nextSlotMs);
}

/** A stopped worker can continue only if every final send has a durable receipt or evidence fence. */
export async function recoverInterruptedPublication(tx:Tx,workspace:Ref,ruleRef:Ref,slotRef:Ref,rule:Data,slot:Data,now:number){
 const context:AutonomyDispatchContext={workspaceId:workspace.id,ruleId:ruleRef.id,jobId:slotRef.id,draftId:slot.draftId,revision:slot.ruleRevision,run:rule.processingRun};
 const guardRef=dispatchGuard(workspace);
 const ledgerRef=workspace.collection('publish_jobs').doc(context.draftId);
 const draftRef=workspace.collection('social_drafts').doc(context.draftId);
 const [guardSnapshot,ledgerSnapshot,draftSnapshot]=await tx.getAll(guardRef,ledgerRef,draftRef);
 const guard=guardSnapshot.data(),ledger=ledgerSnapshot.data();
 if(ledger?.state==='published'&&Array.isArray(ledger.receipts)&&ledger.receipts.length&&ledger.receipts.every((receipt:PublishReceipt)=>receipt?.status==='published'&&!!(receipt.externalPostId||receipt.providerContainerId))){
  tx.update(slotRef,{state:'published',receipts:ledger.receipts,error:'',retryAt:null,finishedAt:now});
  tx.update(ruleRef,{...processingReset,pendingJob:null,nextDueMs:rule.nextSlotMs,lastError:'',...(rule.nextSlotMs===null?{enabled:false,revision:rule.revision+1}:{})});
  return true;
 }
 const ownsGuard=isDispatchFor(guard,context);
 if(ownsGuard&&guard?.phase==='final'){
  tx.update(slotRef,{state:'needs_attention',error:'Veloxa sedang memeriksa hasil pengiriman sebelumnya.',retryAt:null,finishedAt:null});
  tx.update(ruleRef,{...processingReset,pendingJob:null,pendingReconciliation:slotRef.id,nextDueMs:rule.nextSlotMs,lastError:'Hasil pengiriman sedang dikonfirmasi.'});
  return true;
 }
 if(guard?.leaseId&&(!ownsGuard||guard.phase!=='prepare'))return false;
 const frozen=frozenTargets(draftSnapshot.data(),workspace.id,context.draftId,rule.businessId);
 if(!frozen)return false;
 // No ledger means publication had not yet reserved quota or reached a provider.
 if(!ledger&&canResumeSlot(slot,rule,now)){
  tx.update(slotRef,{state:'queued',error:'',retryAt:null,finishedAt:null});
  tx.update(ruleRef,{...processingReset,pendingJob:slotRef.id,nextDueMs:now,lastError:''});
  return true;
 }
 if(!ledger?.quotaReserved||ledger.autonomyRun!==context.run||!['processing','queued'].includes(ledger.state))return false;
 const receipts=targetReceipts(ledger.receipts,frozen.targets);
 if(!receipts||receipts.some(receipt=>receipt.status==='unknown'))return false;
 if(!Array.isArray(ledger.remainingTargets)||ledger.remainingTargets.some((id:unknown)=>!frozen.targets.some(target=>target.connectionId===id)))return false;
 const remaining=frozen.targets.filter(target=>!receipts.some(receipt=>receipt.connectionId===target.connectionId&&receipt.status==='published')&&
  (ledger.remainingTargets.includes(target.connectionId)||!receipts.some(receipt=>receipt.connectionId===target.connectionId)));
 if(remaining.length&&!canResumeSlot(slot,rule,now)){
  if(ownsGuard)tx.delete(guardRef);
  // Safe to resume from Studio, but the autonomous authorization for this slot has expired.
  tx.update(ledgerRef,{state:'queued',remainingTargets:remaining.map(target=>target.connectionId),completedAt:null});
  tx.update(draftRef,{draft:draftPublicationResult(frozen.draft,frozen.targets,receipts,'publish_queued',new Date(now))});
  tx.update(slotRef,{state:'failed',receipts,error:'Waktu untuk melanjutkan slot sudah habis.',retryAt:null,finishedAt:now});
  tx.update(ruleRef,{...processingReset,pendingJob:null,nextDueMs:rule.nextSlotMs,...(rule.nextSlotMs===null?{enabled:false,revision:rule.revision+1}:{})});
  return true;
 }
 const state=remaining.length?'publish_queued':publicationState(receipts);
 if(state==='publish_failed'){
  if(typeof ledger.reservedMonth!=='string'||!/^\d{4}-\d{2}$/.test(ledger.reservedMonth))return false;
  const usageRef=workspace.collection('publish_usage').doc(ledger.reservedMonth);
  const usage=(await tx.get(usageRef)).data();
  if(!Number.isSafeInteger(usage?.count)||usage!.count<1)return false;
  const count=usage!.count-1;
  if(ownsGuard)tx.delete(guardRef);
  tx.set(usageRef,{count},{merge:true});
  if(ledger.reservedMonth===wibMonth(new Date(now)))tx.update(workspace,{quotaUsed:count});
  tx.update(ledgerRef,{state,quotaReserved:false,remainingTargets:[],completedAt:now});
  tx.update(draftRef,{draft:draftPublicationResult(frozen.draft,frozen.targets,receipts,state,new Date(now))});
  tx.update(slotRef,{state:'failed',receipts,error:'Publikasi belum lengkap. Periksa hasil per akun.',retryAt:null,finishedAt:now});
  tx.update(ruleRef,{...processingReset,pendingJob:null,nextDueMs:rule.nextSlotMs,...(rule.nextSlotMs===null?{enabled:false,revision:rule.revision+1}:{})});
  return true;
 }
 if(ownsGuard)tx.delete(guardRef);
 tx.update(ledgerRef,{state:remaining.length?'queued':state,remainingTargets:remaining.map(target=>target.connectionId),completedAt:remaining.length?null:now});
 tx.update(draftRef,{draft:draftPublicationResult(frozen.draft,frozen.targets,receipts,state,new Date(now))});
 tx.update(slotRef,{state:remaining.length?'queued':state==='published'?'published':'failed',receipts,error:'',retryAt:null,finishedAt:remaining.length?null:now});
 tx.update(ruleRef,{
  ...processingReset,pendingJob:remaining.length?slotRef.id:null,nextDueMs:remaining.length?now:rule.nextSlotMs,lastError:'',
  ...(!remaining.length&&rule.nextSlotMs===null?{enabled:false,revision:rule.revision+1}:{}),
 });
 return true;
}

function matchesGuard(guard:Data|undefined,evidence:DispatchEvidence){
 return isDispatchFor(guard,evidence)&&guard?.leaseId===evidence.leaseId&&guard.phase==='final'&&guard.channel===evidence.channel&&
  guard.accountId===evidence.accountId&&guard.kind===evidence.kind&&guard.objectId===evidence.objectId&&guard.host===evidence.host&&guard.version===evidence.version;
}

export async function readAutonomyPublication(evidence:DispatchEvidence,token:string,fetcher:typeof fetch=fetch):Promise<Proof|null>{
 if(evidence.externalPostId&&postId.test(evidence.externalPostId)){
  return {
   externalPostId:evidence.externalPostId,
   ...(evidence.channel==='facebook'?{permalink:evidence.kind==='facebook_reel'? `https://www.facebook.com/reel/${evidence.externalPostId}/`:`https://www.facebook.com/${evidence.externalPostId}`}:{}),
  };
 }
 if(evidence.kind==='post'||!evidence.objectId||!/^\d{1,128}$/.test(evidence.objectId)||!/^v\d+\.\d+$/.test(evidence.version)||!['graph.instagram.com','graph.facebook.com'].includes(evidence.host))return null;
 const url=new URL(`https://${evidence.host}/${evidence.version}/${evidence.objectId}`);
 url.searchParams.set('fields',evidence.kind==='instagram_container'?'status_code':'status');
 try{
  const response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7_000)});
  if(!response.ok)return null;
  const value=await response.json();
  if(value?.id!==evidence.objectId||value.error)return null;
  if(evidence.kind==='instagram_container')return value.status_code==='PUBLISHED'?{providerContainerId:evidence.objectId}:null;
  return isPublishedFacebookReel(value)?{externalPostId:evidence.objectId,permalink:`https://www.facebook.com/reel/${evidence.objectId}/`}:null;
 }catch{return null;}
}

function validEvidence(evidence:DispatchEvidence,ref:Ref){
 return evidence.leaseId===ref.id&&workspaceIdSchema.safeParse(evidence.workspaceId).success&&
  [evidence.ruleId,evidence.jobId,evidence.draftId,evidence.run].every(value=>typeof value==='string'&&documentId.test(value))&&
  evidence.draftId.startsWith('draft_')&&Number.isSafeInteger(evidence.revision)&&Number.isFinite(evidence.startedAt)&&Number.isFinite(evidence.deadline)&&Number.isFinite(evidence.nextCheckAt)&&
  /^[0-9]{1,128}$/.test(evidence.accountId)&&['instagram','facebook'].includes(evidence.channel)&&
  ['instagram_container','facebook_reel','post'].includes(evidence.kind);
}

/** Resolve status only. This path never creates or publishes a remote object. */
export async function reconcileAutonomyPublication(ref:Ref,now:number,deps:LookupDependencies={}){
 const db=ref.firestore;
 const evidence=(await ref.get()).data() as DispatchEvidence|undefined;
 if(!evidence||evidence.nextCheckAt>now)return false;
 if(!validEvidence(evidence,ref)){
  await db.runTransaction(async tx=>{
   const current=(await tx.get(ref)).data() as DispatchEvidence|undefined;
   if(current&&!validEvidence(current,ref))tx.delete(ref);
  });
  return false;
 }
 const workspace=db.collection('workspaces').doc(evidence.workspaceId);
 const rule=db.collection('auto_content_rules').doc(evidence.ruleId);
 const slot=rule.collection('jobs').doc(evidence.jobId);
 const ledger=workspace.collection('publish_jobs').doc(evidence.draftId);
 const draft=workspace.collection('social_drafts').doc(evidence.draftId);
 const guard=dispatchGuard(workspace);
 const [ruleSnapshot,draftSnapshot,guardSnapshot,workspaceSnapshot,slotSnapshot,ledgerSnapshot]=await db.getAll(rule,draft,guard,workspace,slot,ledger);
 const initialRule=ruleSnapshot.data();
 const targetId=socialConnectionId(evidence.channel,evidence.accountId);
 const findTarget=(stored:Data|undefined,ruleData:Data)=>frozenTargets(stored,evidence.workspaceId,evidence.draftId,ruleData.businessId)?.targets.find(item=>item.connectionId===targetId);
 const boundState=(ruleData:Data|undefined,workspaceData:Data|undefined,slotData:Data|undefined,ledgerData:Data|undefined)=>
  !!ruleData&&ruleData.workspaceId===workspace.id&&typeof ruleData.ownerUid==='string'&&ruleData.ownerUid===workspaceData?.ownerUid&&
  slotData?.ruleRevision===evidence.revision&&slotData.draftId===evidence.draftId&&slotData.draftKey===evidence.draftId&&
  ledgerData?.autonomyRun===evidence.run&&ledgerData.requestedBy===ruleData.ownerUid&&ledgerData.quotaReserved&&
  ['processing','needs_attention'].includes(ledgerData.state);
 const canCheck=boundState(initialRule,workspaceSnapshot.data(),slotSnapshot.data(),ledgerSnapshot.data())&&matchesGuard(guardSnapshot.data(),evidence);
 const live=initialRule?.processingRun===evidence.run&&initialRule.processingUntil>now;
 const target=canCheck?findTarget(draftSnapshot.data(),initialRule!):undefined;
 const providerMatches=!!target&&evidence.host===(target.loginProvider==='instagram'?'graph.instagram.com':'graph.facebook.com');
 let proof:Proof|null=null;
 if(canCheck&&!live&&providerMatches&&(evidence.externalPostId||now<=evidence.deadline)){
  if(evidence.externalPostId)proof=await readAutonomyPublication(evidence,'',deps.fetcher);
  else if(evidence.kind!=='post'){
   const accounts=readSocialAccounts((await workspace.collection('private_meta_connections').get()).docs);
   const account=accounts.find(item=>item.connectionId===targetId&&(item.loginProvider||'facebook')===target.loginProvider);
   if(account&&(!account.expiresAt||account.expiresAt>now)){
    try{proof=await readAutonomyPublication(evidence,(deps.decrypt||decryptMetaToken)(account.encryptedToken,workspace.id),deps.fetcher);}catch{/* Leave the durable fence in place when proof is unavailable. */}
   }
  }
 }
 return db.runTransaction(async tx=>{
  const [currentEvidence,guardData,ruleData,slotData,ledgerData,draftData,workspaceData]=
   (await tx.getAll(ref,guard,rule,slot,ledger,draft,workspace)).map(snapshot=>snapshot.data());
  if(currentEvidence?.leaseId!==evidence.leaseId||currentEvidence.nextCheckAt!==evidence.nextCheckAt)return false;
  if(!matchesGuard(guardData,evidence)){
   tx.delete(ref);
   return false;
  }
  if(!ruleData||!slotData||!ledgerData||!boundState(ruleData,workspaceData,slotData,ledgerData)||!findTarget(draftData,ruleData)){
   tx.delete(ref);
   return false;
  }
  const activeRun=ruleData.processingRun===evidence.run&&ruleData.processingUntil>now;
  const ownsRun=ruleData.processingRun===evidence.run&&ruleData.processingJob===slot.id;
  const heldForResult=ruleData.pendingReconciliation===slot.id;
  const mayContinue=(ownsRun||heldForResult)&&ruleData.enabled&&ruleData.revision===evidence.revision;
  const frozen=frozenTargets(draftData,workspace.id,evidence.draftId,ruleData.businessId)!;
  const existing=targetReceipts(ledgerData.receipts,frozen.targets);
  if(!existing||existing.some(receipt=>receipt.status==='unknown'&&receipt.connectionId!==targetId)){
   tx.delete(ref);
   return false;
  }
  const checkedTarget=frozen.targets.find(item=>item.connectionId===targetId)!;
  if(!proof||activeRun){
   if(activeRun||now<evidence.deadline&&evidence.kind!=='post'){
    tx.update(ref,{nextCheckAt:Math.min(evidence.deadline,now+retryDelay)});
   }else{
    const receipts=[...existing.filter(receipt=>receipt.connectionId!==targetId),{
     ...checkedTarget,status:'unknown' as const,error:'Hasil kirim belum dapat dipastikan.',
    }];
    const remaining=frozen.targets.filter(item=>!receipts.some(receipt=>receipt.connectionId===item.connectionId));
    tx.update(ledger,{state:'needs_attention',receipts,remainingTargets:remaining.map(item=>item.connectionId),completedAt:now});
    tx.update(draft,{draft:draftPublicationResult(frozen.draft,frozen.targets,receipts,'needs_attention',new Date(now))});
    tx.delete(ref);
    tx.update(slot,{state:'needs_attention',receipts,error:'Hasil kirim belum dapat dipastikan. Periksa akun sosial sebelum melanjutkan.',finishedAt:now});
    if(heldForResult||ownsRun)tx.update(rule,{
     ...processingReset,pendingReconciliation:null,
     ...(mayContinue?{enabled:false,revision:ruleData.revision+1,pendingJob:null,lastError:'Hasil kirim belum dapat dipastikan.'}:{}),
    });
   }
   return false;
  }
  const previous=existing.find(receipt=>receipt.connectionId===targetId);
  if(previous?.status==='failed'&&!ledgerData.remainingTargets?.includes(targetId)){
   tx.delete(ref);
   return false;
  }
  const confirmedAt=new Date(now).toISOString();
  const confirmedReceipt=previous?.status==='published'?previous:{
   ...checkedTarget,status:'published' as const,...proof,confirmedAt,
  };
  const receipts=[...existing.filter(receipt=>receipt.connectionId!==targetId),confirmedReceipt];
  const remaining=frozen.targets.filter(item=>!receipts.some(receipt=>receipt.connectionId===item.connectionId));
  const resumeBatch=remaining.length>0&&mayContinue&&canResumeSlot(slotData,ruleData,now);
  const state=remaining.length?'publish_queued':publicationState(receipts);
  const slotState=resumeBatch?'queued':remaining.length?'cancelled':state==='published'?'published':'failed';
  tx.update(ledger,{
   state:remaining.length?'queued':state,receipts,remainingTargets:remaining.map(item=>item.connectionId),
   completedAt:remaining.length?null:now,
  });
  tx.update(draft,{draft:draftPublicationResult(frozen.draft,frozen.targets,receipts,state,new Date(now))});
  tx.update(slot,{
   state:slotState,receipts,error:slotState==='cancelled'?'Pengiriman terkonfirmasi. Akun tersisa tidak dilanjutkan oleh slot ini.':'',
   retryAt:null,finishedAt:resumeBatch?null:now,
   ...(resumeBatch?{ruleRevision:ruleData.revision}:{}),
  });
  if(heldForResult||ownsRun){
   const hasFuture=typeof ruleData.nextSlotMs==='number';
   tx.update(rule,{
    ...processingReset,pendingReconciliation:null,
    ...(mayContinue?{
     pendingJob:resumeBatch?slot.id:null,lastError:'',enabled:resumeBatch||hasFuture,
     nextDueMs:resumeBatch?now:ruleData.nextSlotMs,
     ...(!resumeBatch&&!hasFuture?{revision:ruleData.revision+1}:{}),
    }:{}),
   });
  }
  tx.delete(guard);
  tx.delete(ref);
  return true;
 });
}

export async function reconcileDueAutonomyPublications(db:Database,now:number){
 const pending=await db.collection(publicationReconciliationCollection).where('nextCheckAt','<=',now).orderBy('nextCheckAt','asc').limit(4).get();
 const results=await Promise.allSettled(pending.docs.map(document=>reconcileAutonomyPublication(document.ref,now)));
 for(const result of results)if(result.status==='rejected')console.error(JSON.stringify({event:'organic_publication_reconcile_failed'}));
 return results.filter(result=>result.status==='fulfilled'&&result.value).length;
}
