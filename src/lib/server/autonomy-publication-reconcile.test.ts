import assert from 'node:assert/strict';
import test from 'node:test';
import {createAutonomyDispatch,dispatchGuard,persistAutonomyReceipt,publicationReconciliationCollection,type AutonomyDispatchContext} from './autonomy-dispatch';
import {reconcileAutonomyPublication,recoverInterruptedPublication} from './autonomy-publication-reconcile';
import type {PublishReceipt} from './publishing';
import {wibMonth} from './clock';

type Data=Record<string,any>;
class FakeRef{
 constructor(readonly firestore:FakeDb,readonly path:string){}
 get id(){return this.path.split('/').at(-1)!;}
 collection(name:string){return this.firestore.collection(`${this.path}/${name}`);}
 async get(){return{data:()=>this.firestore.records.get(this.path)};}
}
class FakeDb{
 records=new Map<string,Data>();
 collection(path:string){
  return {
   doc:(id:string)=>new FakeRef(this,`${path}/${id}`),
   get:async()=>({docs:[...this.records.entries()].filter(([key])=>key.startsWith(`${path}/`)&&!key.slice(path.length+1).includes('/')).map(([key,value])=>({id:key.split('/').at(-1)!,data:()=>value}))}),
  };
 }
 getAll(...refs:FakeRef[]){return Promise.all(refs.map(ref=>ref.get()));}
 runTransaction<T>(fn:(tx:FirebaseFirestore.Transaction)=>Promise<T>){
  const write=(ref:FakeRef,value:Data)=>this.records.set(ref.path,{...this.records.get(ref.path),...value});
  const tx={
   get:(ref:FakeRef)=>ref.get(),
   getAll:(...refs:FakeRef[])=>this.getAll(...refs),
   create:(ref:FakeRef,value:Data)=>{assert.equal(this.records.has(ref.path),false);write(ref,value);},
   set:write,update:write,delete:(ref:FakeRef)=>this.records.delete(ref.path),
  };
  return fn(tx as unknown as FirebaseFirestore.Transaction);
 }
}

function fixture(accountIds=['200']){
 const db=new FakeDb();
 const context:AutonomyDispatchContext={workspaceId:'legacy.workspace%40test',ruleId:'rule_test',jobId:'slot_1',draftId:'draft_exact',revision:2,run:'run_test'};
 const workspace=db.collection('workspaces').doc(context.workspaceId);
 const rule=db.collection('auto_content_rules').doc(context.ruleId);
 const slot=rule.collection('jobs').doc(context.jobId);
 const ledger=workspace.collection('publish_jobs').doc(context.draftId);
 const draft=workspace.collection('social_drafts').doc(context.draftId);
 const month=wibMonth();
 const usage=workspace.collection('publish_usage').doc(month);
 const guard=dispatchGuard(workspace as never);
 const now=Date.now();
 const targets=accountIds.map(accountId=>({connectionId:`instagram_${accountId}`,channel:'instagram' as const,accountId,accountName:'Berez ERP',handle:'berezerp',loginProvider:'instagram'}));
 db.records.set(workspace.path,{ownerUid:'owner',quotaUsed:1});
 db.records.set(rule.path,{workspaceId:workspace.id,businessId:'primary',ownerUid:'owner',revision:2,enabled:true,processingRun:context.run,processingJob:slot.id,processingUntil:now+6*60_000,nextSlotMs:null});
 db.records.set(slot.path,{draftId:draft.id,draftKey:draft.id,ruleRevision:2,scheduledAt:now,state:'publishing'});
 db.records.set(draft.path,{targetBindings:targets,draft:{id:draft.id,workspaceId:workspace.id,status:'publishing'}});
 db.records.set(ledger.path,{state:'processing',receipts:[],remainingTargets:targets.map(target=>target.connectionId),quotaReserved:true,reservedMonth:month,autonomyRun:context.run,requestedBy:'owner'});
 db.records.set(usage.path,{count:1});
 for(const target of targets)db.records.set(workspace.collection('private_meta_connections').doc(target.connectionId).path,{...target,encryptedToken:'encrypted'});
 const evidence=()=>{
  const path=[...db.records.keys()].find(key=>key.startsWith(publicationReconciliationCollection+'/'));
  assert.ok(path);
  return new FakeRef(db,path);
 };
 const pauseForResult=(ownerPaused=false)=>{
  const data=db.records.get(rule.path)!;
  Object.assign(data,{
   processingRun:null,processingJob:null,processingUntil:0,pendingReconciliation:slot.id,
   enabled:!ownerPaused,revision:ownerPaused?3:2,
  });
 };
 return {db,workspace,rule,slot,ledger,draft,usage,guard,context,now,targets,evidence,pauseForResult};
}

const url='https://graph.instagram.com/v26.0/200/media_publish';
const sendBody={method:'POST',body:new URLSearchParams({creation_id:'777'})};

test('lost Instagram acknowledgement is reconciled by exact container GET and can resume only remaining authorized destinations',async()=>{
 const f=fixture(['200','201']);
 let sends=0;
 const dispatch=createAutonomyDispatch(f.workspace as never,async()=>{},async()=>{sends++;throw new Error('connection closed after dispatch');},undefined,f.context);
 await assert.rejects(dispatch(url,sendBody));
 assert.equal(sends,1);
 const unknown:PublishReceipt={...f.targets[0],status:'unknown'};
 await persistAutonomyReceipt(f.workspace as never,f.context,unknown,[unknown],['instagram_201']);
 const evidence=f.evidence();
 assert.equal(f.db.records.get(evidence.path)?.objectId,'777');
 assert.equal(f.db.records.get(f.guard.path)?.leaseId,evidence.id);
 f.pauseForResult();
 const now=f.db.records.get(evidence.path)!.nextCheckAt;
 const fetcher:typeof fetch=async(input,init)=>{
  assert.equal(String(input),'https://graph.instagram.com/v26.0/777?fields=status_code');
  assert.equal(init?.method,'GET');
  return Response.json({id:'777',status_code:'PUBLISHED'});
 };
 assert.equal(await reconcileAutonomyPublication(evidence as never,now,{fetcher,decrypt:()=> 'token'}),true);
 const saved=f.db.records.get(f.ledger.path)!;
 assert.equal(saved.state,'queued');
 assert.deepEqual(saved.remainingTargets,['instagram_201']);
 assert.equal(saved.receipts[0].status,'published');
 assert.equal(saved.receipts[0].providerContainerId,'777');
 assert.equal(saved.receipts[0].externalPostId,undefined);
 assert.equal(f.db.records.get(f.slot.path)?.state,'queued');
 assert.equal(f.db.records.get(f.rule.path)?.pendingJob,f.slot.id);
 assert.equal(f.db.records.get(f.usage.path)?.count,1);
 assert.equal(f.db.records.has(f.guard.path),false);
 assert.equal(await reconcileAutonomyPublication(evidence as never,now,{fetcher}),false);
 assert.equal(sends,1);
});

test('one-time Instagram confirmation updates the draft and never resumes a rule the owner paused',async()=>{
 for(const ownersPause of [false,true]){
  const f=fixture(ownersPause?['200','201']:['200']);
  const dispatch=createAutonomyDispatch(f.workspace as never,async()=>{},async()=>{throw new Error('lost');},undefined,f.context);
  await assert.rejects(dispatch(url,sendBody));
  f.pauseForResult(ownersPause);
  const evidence=f.evidence();
  const now=f.db.records.get(evidence.path)!.nextCheckAt;
  assert.equal(await reconcileAutonomyPublication(evidence as never,now,{decrypt:()=> 'token',fetcher:async()=>Response.json({id:'777',status_code:'PUBLISHED'})}),true);
  const rule=f.db.records.get(f.rule.path)!;
  assert.equal(rule.enabled,false);
  assert.equal(rule.pendingReconciliation,null);
  assert.equal(f.db.records.get(f.slot.path)?.state,ownersPause?'cancelled':'published');
  assert.equal(f.db.records.get(f.draft.path)?.draft.status,ownersPause?'publish_queued':'published');
  assert.equal(f.db.records.get(f.draft.path)?.draft.publishedAtWib,undefined);
 }
});

test('a remote ID recorded before a worker crash repairs the ledger without querying or publishing again',async()=>{
 const f=fixture();
 const dispatch=createAutonomyDispatch(f.workspace as never,async()=>{},async()=>Response.json({id:'888'}),undefined,f.context);
 await dispatch(url,sendBody);
 const evidence=f.evidence();
 const now=f.db.records.get(evidence.path)!.nextCheckAt;
 assert.equal(await reconcileAutonomyPublication(evidence as never,now,{fetcher:async()=>assert.fail('durable acknowledgement is sufficient')}),true);
 assert.equal(f.db.records.get(f.ledger.path)?.receipts[0].externalPostId,'888');
 assert.equal(f.db.records.get(f.slot.path)?.state,'published');
 assert.equal(f.db.records.has(f.guard.path),false);
});

test('wrong container and FINISHED cannot turn uncertainty into success; deadline retains fence and quota',async()=>{
 const f=fixture();
 const dispatch=createAutonomyDispatch(f.workspace as never,async()=>{},async()=>{throw new Error('lost');},undefined,f.context);
 await assert.rejects(dispatch(url,sendBody));
 const evidence=f.evidence();
 const entry=f.db.records.get(evidence.path)!;
 assert.equal(await reconcileAutonomyPublication(evidence as never,entry.nextCheckAt,{decrypt:()=> 'token',fetcher:async()=>Response.json({id:'999',status_code:'PUBLISHED'})}),false);
 assert.equal(f.db.records.get(f.ledger.path)?.state,'processing');
 assert.equal(await reconcileAutonomyPublication(evidence as never,entry.deadline,{decrypt:()=> 'token',fetcher:async()=>Response.json({id:'777',status_code:'FINISHED'})}),false);
 assert.equal(f.db.records.get(f.ledger.path)?.state,'needs_attention');
 assert.equal(f.db.records.get(f.ledger.path)?.receipts[0].status,'unknown');
 assert.equal(f.db.records.get(f.draft.path)?.draft.status,'needs_attention');
 assert.equal(f.db.records.get(f.usage.path)?.count,1);
 assert.equal(f.db.records.has(f.guard.path),true);
 assert.equal(f.db.records.has(evidence.path),false);
});

test('a final receipt releases its fence in the same write, and a crash before aggregate save finalizes it',async()=>{
 const f=fixture();
 const dispatch=createAutonomyDispatch(f.workspace as never,async()=>{},async()=>Response.json({id:'888'}),undefined,f.context);
 await dispatch(url,sendBody);
 const evidence=f.evidence();
 const receipt:PublishReceipt={...f.targets[0],status:'published',externalPostId:'888'};
 await persistAutonomyReceipt(f.workspace as never,f.context,receipt,[receipt],[]);
 assert.equal(f.db.records.has(f.guard.path),false);
 assert.equal(f.db.records.has(evidence.path),false);
 const rule=f.db.records.get(f.rule.path)!;
 const slot=f.db.records.get(f.slot.path)!;
 assert.equal(await f.db.runTransaction(tx=>recoverInterruptedPublication(tx,f.workspace as never,f.rule as never,f.slot as never,rule,slot,f.now+6*60_000)),true);
 assert.equal(f.db.records.get(f.ledger.path)?.state,'published');
 assert.equal(f.db.records.get(f.draft.path)?.draft.status,'published');
 assert.equal(f.db.records.get(f.usage.path)?.count,1);
});

test('an abandoned preparation creates no durable fence and can safely resume the existing draft',async()=>{
 const f=fixture();
 const dispatch=createAutonomyDispatch(f.workspace as never,async()=>{},async()=>{throw new Error('lost');},undefined,f.context);
 await assert.rejects(dispatch('https://graph.instagram.com/v26.0/200/media',{method:'POST'}));
 assert.equal(f.db.records.has(f.guard.path),false);
 const rule=f.db.records.get(f.rule.path)!;
 const slot=f.db.records.get(f.slot.path)!;
 assert.equal(await f.db.runTransaction(tx=>recoverInterruptedPublication(tx,f.workspace as never,f.rule as never,f.slot as never,rule,slot,f.now+6*60_000)),true);
 assert.equal(f.db.records.get(f.ledger.path)?.state,'queued');
 assert.equal(f.db.records.get(f.usage.path)?.count,1);
 assert.equal(f.db.records.get(f.rule.path)?.pendingJob,f.slot.id);
});

test('a crashed batch with only definitive failures refunds its quota atomically',async()=>{
 const f=fixture();
 Object.assign(f.db.records.get(f.ledger.path)!,{remainingTargets:[],receipts:[{...f.targets[0],status:'failed'}]});
 const rule=f.db.records.get(f.rule.path)!;
 const slot=f.db.records.get(f.slot.path)!;
 assert.equal(await f.db.runTransaction(tx=>recoverInterruptedPublication(tx,f.workspace as never,f.rule as never,f.slot as never,rule,slot,f.now+6*60_000)),true);
 assert.equal(f.db.records.get(f.ledger.path)?.state,'publish_failed');
 assert.equal(f.db.records.get(f.usage.path)?.count,0);
 assert.equal(f.db.records.get(f.workspace.path)?.quotaUsed,0);
 assert.equal(f.db.records.get(f.ledger.path)?.quotaReserved,false);
});

test('malformed and cross-workspace reconciliation records do not access Meta or release a fence',async()=>{
 for(const mode of ['malformed','owner_changed']){
  const f=fixture();
  const dispatch=createAutonomyDispatch(f.workspace as never,async()=>{},async()=>{throw new Error('lost');},undefined,f.context);
  await assert.rejects(dispatch(url,sendBody));
  const evidence=f.evidence();
  const entry=f.db.records.get(evidence.path)!;
  if(mode==='malformed')entry.workspaceId='different/path';
  else f.db.records.get(f.workspace.path)!.ownerUid='different-owner';
  let credentialReads=0;
  let remoteReads=0;
  assert.equal(await reconcileAutonomyPublication(evidence as never,entry.nextCheckAt,{
   decrypt:()=>{credentialReads++;return 'token';},
   fetcher:async()=>{remoteReads++;return Response.json({id:'777',status_code:'PUBLISHED'});},
  }),false);
  assert.equal(credentialReads,0);
  assert.equal(remoteReads,0);
  assert.equal(f.db.records.has(evidence.path),false);
  assert.equal(f.db.records.has(f.guard.path),true);
  assert.equal(f.db.records.get(f.usage.path)?.count,1);
 }
});
