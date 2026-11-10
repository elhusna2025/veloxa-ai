import {randomUUID} from 'node:crypto';
import {ApiError} from './http';
type Ref=FirebaseFirestore.DocumentReference;
type Tx=FirebaseFirestore.Transaction;
export const dispatchGuard=(workspace:Ref)=>workspace.collection('server_operation_guards').doc('organic_dispatch');
/** Durable fence, deliberately without an automatic expiry: an ambiguous/crashed send needs inspection. */
export async function assertNoAutonomyDispatch(tx:Tx,workspace:Ref){
 if((await tx.get(dispatchGuard(workspace))).data()?.leaseId)throw new ApiError(409,'Pengiriman otomatis sedang berlangsung atau hasilnya belum pasti. Jeda aturan dan periksa aktivitas sebelum mengubah akun, profil, atau aset.','autonomy_dispatch_in_progress');
}
export function createAutonomyDispatch(workspace:Ref,check:(tx:Tx)=>Promise<unknown>,fetcher:typeof fetch=fetch):typeof fetch{
 let tail=Promise.resolve();
 return async(input,init)=>{
  if((init?.method||(input instanceof Request?input.method:'GET')).toUpperCase()!=='POST')return fetcher(input,init);
  const previous=tail;let unlock!:()=>void;tail=new Promise<void>(resolve=>unlock=resolve);await previous;
  const db=workspace.firestore;const guard=dispatchGuard(workspace);const leaseId=randomUUID();let claimed=false,settled=false;
  try{
   await db.runTransaction(async tx=>{await assertNoAutonomyDispatch(tx,workspace);await check(tx);tx.create(guard,{leaseId,startedAt:Date.now()});});claimed=true;
   const response=await fetcher(input,init);
   // Wait for the entire provider response. A timeout/truncated JSON/5xx is not a definitive rejection.
   const body=await response.clone().json() as {id?:unknown;post_id?:unknown;error?:{code?:unknown}};
   settled=!!body&&typeof body==='object'&&response.status<500&&(typeof body.id==='string'||typeof body.post_id==='string'||typeof body.error?.code==='number');
   return response;
  }finally{
   try{if(claimed&&settled)await db.runTransaction(async tx=>{if((await tx.get(guard)).data()?.leaseId===leaseId)tx.delete(guard);});}finally{unlock();}
  }
 };
}
