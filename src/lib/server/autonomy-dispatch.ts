import {randomUUID} from 'node:crypto';
import {ApiError} from './http';
import {isPublishedFacebookReel} from './meta-reels';
import type {PublishReceipt} from './publishing';
type Ref=FirebaseFirestore.DocumentReference;
type Tx=FirebaseFirestore.Transaction;
export const dispatchGuard=(workspace:Ref)=>workspace.collection('server_operation_guards').doc('organic_dispatch');
export const publicationReconciliationCollection='organic_publish_reconciliation';
export type AutonomyDispatchContext = {
 workspaceId:string;
 ruleId:string;
 jobId:string;
 draftId:string;
 revision:number;
 run:string;
};
export type DispatchEvidence = AutonomyDispatchContext & {
 leaseId:string;
 accountId:string;
 channel:'instagram'|'facebook';
 version:string;
 host:'graph.instagram.com'|'graph.facebook.com';
 kind:'instagram_container'|'facebook_reel'|'post';
 objectId:string|null;
 startedAt:number;
 nextCheckAt:number;
 deadline:number;
 externalPostId?:string;
};
export const isDispatchFor=(data:FirebaseFirestore.DocumentData|undefined,context:AutonomyDispatchContext)=>
 !!data&&data.workspaceId===context.workspaceId&&data.ruleId===context.ruleId&&data.jobId===context.jobId&&data.draftId===context.draftId&&data.revision===context.revision&&data.run===context.run;

/** Durable fence, deliberately without an automatic expiry: an ambiguous/crashed send needs inspection. */
export async function assertNoAutonomyDispatch(tx:Tx,workspace:Ref){
 if((await tx.get(dispatchGuard(workspace))).data()?.leaseId)throw new ApiError(409,'Pengiriman otomatis sedang berlangsung atau hasilnya belum pasti. Jeda aturan dan periksa aktivitas sebelum mengubah akun, profil, atau aset.','autonomy_dispatch_in_progress');
}
export function createAutonomyDispatch(workspace:Ref,check:(tx:Tx)=>Promise<unknown>,fetcher:typeof fetch=fetch,remainingTime?:()=>number,context?:AutonomyDispatchContext):typeof fetch{
 let tail=Promise.resolve();
 let reelCheck:{leaseId:string;videoId:string;version:string}|undefined;
 const db=workspace.firestore;
 const guard=dispatchGuard(workspace);
 const evidenceRef=(id:string)=>db.collection(publicationReconciliationCollection).doc(id);
 const release=(leaseId:string,trackedFinal=false)=>db.runTransaction(async tx=>{
  if((await tx.get(guard)).data()?.leaseId!==leaseId)return;
  if(trackedFinal)tx.delete(evidenceRef(leaseId));
  tx.delete(guard);
 });
 const checkpoint=(leaseId:string,externalPostId:string)=>db.runTransaction(async tx=>{
  if((await tx.get(guard)).data()?.leaseId!==leaseId)return;
  tx.update(evidenceRef(leaseId),{externalPostId});
 });
 return async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  const graph=url.origin==='https://graph.facebook.com'||url.origin==='https://graph.instagram.com';
  const graphPath=/^\/(v\d+\.\d+)\/(\d+)(?:\/(media|photos|video_reels))?$/.exec(url.pathname);
  const send=()=>{
   if(!remainingTime)return fetcher(input,init);
   const ms=Math.floor(remainingTime());
   if(ms<=0)throw new ApiError(503,'Waktu pengiriman slot habis sebelum permintaan dikirim.','autonomy_send_not_started');
   const deadline=AbortSignal.timeout(ms);
   return fetcher(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,deadline]):deadline});
  };
  if((init?.method||(input instanceof Request?input.method:'GET')).toUpperCase()!=='POST'){
   const response=await send();
   const candidate=reelCheck;
   if(candidate&&url.origin==='https://graph.facebook.com'&&url.pathname===`/${candidate.version}/${candidate.videoId}`&&url.searchParams.get('fields')==='status'&&response.ok){
    const result=await response.clone().json().catch(()=>undefined);
    if(!result?.error&&isPublishedFacebookReel(result)){
     if(context)await checkpoint(candidate.leaseId,candidate.videoId);
     else await release(candidate.leaseId);
     reelCheck=undefined;
    }
   }
   return response;
  }
  const form=init?.body instanceof URLSearchParams||init?.body instanceof FormData?init.body:undefined;
  const phase=form?.get('upload_phase');
  const isFacebook=url.origin==='https://graph.facebook.com';
  const prepare=graph&&graphPath?.[3]==='media'
   ||isFacebook&&graphPath?.[3]==='photos'&&form?.get('published')==='false'
   ||isFacebook&&graphPath?.[3]==='video_reels'&&phase==='start'
   ||url.origin==='https://rupload.facebook.com'&&/^\/video-upload\/v\d+\.\d+\/\d+$/.test(url.pathname);
  // Preparation cannot make a post public. The final request rechecks the rule and account
  // in the same transaction that claims the durable fence.
  if(prepare&&context){
   await db.runTransaction(check);
   return send();
  }
  const reelId=isFacebook&&graphPath?.[3]==='video_reels'&&phase==='finish'?form?.get('video_id'):undefined;
  const instagramFinal=graph&&/^\/v\d+\.\d+\/\d+\/media_publish$/.test(url.pathname);
  const containerId=instagramFinal?form?.get('creation_id'):undefined;
  const [version,accountId]=url.pathname.split('/').slice(1,3);
  const objectId=typeof containerId==='string'&&/^\d+$/.test(containerId)?containerId:
   typeof reelId==='string'&&/^\d+$/.test(reelId)?reelId:null;
  const previous=tail;let unlock!:()=>void;tail=new Promise<void>(resolve=>unlock=resolve);await previous;
  const leaseId=randomUUID();
  const startedAt=Date.now();
  const evidence:DispatchEvidence|undefined=context&&!prepare&&graph&&/^v\d+\.\d+$/.test(version)&&/^\d+$/.test(accountId)?{
   ...context,leaseId,accountId,channel:instagramFinal?'instagram':'facebook',version,
   host:isFacebook?'graph.facebook.com':'graph.instagram.com',
   kind:instagramFinal&&objectId?'instagram_container':reelId&&objectId?'facebook_reel':'post',
   objectId,startedAt,nextCheckAt:startedAt+6*60_000,deadline:startedAt+30*60_000,
  }:undefined;
  let claimed=false,settled=false,confirmedId:string|undefined;
  try{
   await db.runTransaction(async tx=>{
    await assertNoAutonomyDispatch(tx,workspace);
    await check(tx);
    tx.create(guard,{
     ...context,leaseId,startedAt,phase:prepare?'prepare':'final',
     ...(evidence?{accountId:evidence.accountId,channel:evidence.channel,kind:evidence.kind,objectId:evidence.objectId,host:evidence.host,version:evidence.version}:{}),
    });
    if(evidence)tx.create(evidenceRef(leaseId),evidence);
   });
   claimed=true;
   if(typeof reelId==='string'&&/^\d+$/.test(reelId))reelCheck={leaseId,videoId:reelId,version:graphPath![1]};
   const response=await send();
   if(prepare)return response;
   // Wait for the entire provider response. A timeout/truncated JSON/5xx is not a definitive rejection.
   const body=await response.clone().json() as {id?:unknown;post_id?:unknown;success?:unknown;error?:{code?:unknown}};
   const id=body?.post_id||body?.id;
   const code=body?.error?.code;
   const rejected=typeof code==='number'&&Number.isSafeInteger(code)&&code>0&&!id&&body.success!==true&&response.status<500;
   // Reels 'finish' only accepts processing. Its fence clears after a confirmed status read.
   confirmedId=!reelCheck&&response.ok&&!body?.error&&typeof id==='string'&&(graph?/^\d+(?:_\d+)?$/.test(id):!!id)?id:undefined;
   settled=rejected||!evidence&&!!confirmedId;
   if(evidence&&confirmedId)await checkpoint(leaseId,confirmedId);
   return response;
  }catch(error){
   if(error instanceof ApiError&&error.code==='autonomy_send_not_started')settled=true;
   throw error;
  }finally{
   try{if(claimed&&(prepare||settled)){await release(leaseId,!!evidence);if(reelCheck?.leaseId===leaseId)reelCheck=undefined;}}finally{unlock();}
  }
 };
}

/** Commit the receipt before releasing the fence that excludes a duplicate send. */
export async function persistAutonomyReceipt(workspace:Ref,context:AutonomyDispatchContext,receipt:PublishReceipt,receipts:PublishReceipt[],remainingTargets:string[]){
 const db=workspace.firestore;
 const guard=dispatchGuard(workspace);
 const ledger=workspace.collection('publish_jobs').doc(context.draftId);
 await db.runTransaction(async tx=>{
  const [guardSnapshot,ledgerSnapshot]=await tx.getAll(guard,ledger);
  const current=guardSnapshot.data();
  const job=ledgerSnapshot.data();
  if(job?.state!=='processing'||job.autonomyRun!==context.run)throw new ApiError(409,'Proses publikasi sudah berpindah.','delivery_unknown');
  const tracked=isDispatchFor(current,context)&&current?.accountId===receipt.accountId&&current?.channel===receipt.channel;
  tx.update(ledger,{receipts,remainingTargets});
  if(!tracked)return;
  const evidence=db.collection(publicationReconciliationCollection).doc(current!.leaseId);
  if(receipt.status==='unknown'){
   tx.update(evidence,{nextCheckAt:Date.now()+60_000});
   return;
  }
  tx.delete(evidence);
  tx.delete(guard);
 });
}
