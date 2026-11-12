import {randomUUID} from 'node:crypto';
import {ApiError} from './http';
import {isPublishedFacebookReel} from './meta-reels';
type Ref=FirebaseFirestore.DocumentReference;
type Tx=FirebaseFirestore.Transaction;
export const dispatchGuard=(workspace:Ref)=>workspace.collection('server_operation_guards').doc('organic_dispatch');
/** Durable fence, deliberately without an automatic expiry: an ambiguous/crashed send needs inspection. */
export async function assertNoAutonomyDispatch(tx:Tx,workspace:Ref){
 if((await tx.get(dispatchGuard(workspace))).data()?.leaseId)throw new ApiError(409,'Pengiriman otomatis sedang berlangsung atau hasilnya belum pasti. Jeda aturan dan periksa aktivitas sebelum mengubah akun, profil, atau aset.','autonomy_dispatch_in_progress');
}
export function createAutonomyDispatch(workspace:Ref,check:(tx:Tx)=>Promise<unknown>,fetcher:typeof fetch=fetch,remainingTime?:()=>number):typeof fetch{
 let tail=Promise.resolve();
 let reelCheck:{leaseId:string;videoId:string;version:string}|undefined;
 const db=workspace.firestore;
 const guard=dispatchGuard(workspace);
 const release=(leaseId:string)=>db.runTransaction(async tx=>{if((await tx.get(guard)).data()?.leaseId===leaseId)tx.delete(guard);});
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
    if(!result?.error&&isPublishedFacebookReel(result)){await release(candidate.leaseId);reelCheck=undefined;}
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
  const reelId=isFacebook&&graphPath?.[3]==='video_reels'&&phase==='finish'?form?.get('video_id'):undefined;
  const previous=tail;let unlock!:()=>void;tail=new Promise<void>(resolve=>unlock=resolve);await previous;
  const leaseId=randomUUID();let claimed=false,settled=false;
  try{
   await db.runTransaction(async tx=>{await assertNoAutonomyDispatch(tx,workspace);await check(tx);tx.create(guard,{leaseId,startedAt:Date.now()});});claimed=true;
   if(typeof reelId==='string'&&/^\d+$/.test(reelId))reelCheck={leaseId,videoId:reelId,version:graphPath![1]};
   const response=await send();
   if(prepare)return response;
   // Wait for the entire provider response. A timeout/truncated JSON/5xx is not a definitive rejection.
   const body=await response.clone().json() as {id?:unknown;post_id?:unknown;success?:unknown;error?:{code?:unknown}};
   const id=body?.post_id||body?.id;
   const code=body?.error?.code;
   const rejected=typeof code==='number'&&Number.isSafeInteger(code)&&code>0&&!id&&body.success!==true&&response.status<500;
   // Reels 'finish' only accepts processing. Its fence clears after a confirmed status read.
   settled=rejected||!reelCheck&&response.ok&&!body?.error&&typeof id==='string'&&(graph?/^\d+(?:_\d+)?$/.test(id):!!id);
   return response;
  }catch(error){
   if(error instanceof ApiError&&error.code==='autonomy_send_not_started')settled=true;
   throw error;
  }finally{
   try{if(claimed&&(prepare||settled)){await release(leaseId);if(reelCheck?.leaseId===leaseId)reelCheck=undefined;}}finally{unlock();}
  }
 };
}
