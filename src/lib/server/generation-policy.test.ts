import test from 'node:test';
import assert from 'node:assert/strict';
import { generationPolicy, generationQuotaStatus, reserveGenerationAttempt } from './generation-policy';
function fake({config,configError=false,count=6}:{config?:unknown;configError?:boolean;count?:unknown}={}) {
 let value=count;let writes=0;const usage={get:async()=>({data:()=>({count:value})})};
 const ref={collection:()=>({doc:()=>usage}),firestore:{collection:(name:string)=>{assert.equal(name,'platform_configs');return{doc:(id:string)=>{assert.equal(id,'generation_workspace-a');return{get:async()=>{if(configError)throw Error('unavailable');return{data:()=>config}}}}}},runTransaction:async(action:any)=>action({get:(doc:any)=>doc.get(),set:(_ref:any,data:any)=>{writes++;value=data.count;}})}};
 return {ref:ref as never,value:()=>value,writes:()=>writes};
}
test('unreadable admin configuration fails closed and standard status remains explicit',async()=>{
 const f=fake({configError:true});assert.deepEqual(await generationPolicy(f.ref,'workspace-a','free_trial'),{mode:'standard',dailyLimit:6});
 const status=await generationQuotaStatus(f.ref,'workspace-a','free_trial');assert.equal(status.mode,'standard');assert.equal(status.dailyLimit,6);assert.equal(status.used,6);
 await assert.rejects(reserveGenerationAttempt(f.ref,'workspace-a','free_trial'),/hari ini tercapai/);assert.equal(f.writes(),0);
});
test('even development mode rejects corrupt and overflowing counters before any increment',async()=>{
 for(const count of [-1,NaN,1.5,'6',null,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1]){
  const f=fake({config:{workspaceId:'workspace-a',mode:'development',enabled:true},count});
  await assert.rejects(reserveGenerationAttempt(f.ref,'workspace-a','free_trial'),/belum dapat diverifikasi/);assert.equal(f.writes(),0);
 }
});
test('revocation before reservation is read through the same transaction, never from a stale external policy',async()=>{
 let enabled=true;let writes=0;let inTransaction=false;const reads:string[]=[];
 const policyRef={kind:'policy'};const usageRef={kind:'usage'};
 const ref={collection:()=>({doc:()=>usageRef}),firestore:{collection:()=>({doc:()=>policyRef}),runTransaction:async(action:any)=>{
  // Admin revokes after the request starts, before the reservation transaction begins.
  enabled=false;inTransaction=true;
  try{return await action({get:async(doc:any)=>{assert.equal(inTransaction,true);reads.push(doc.kind);return{data:()=>doc===policyRef?{workspaceId:'workspace-a',mode:'development',enabled}:{count:6}}},set:()=>{writes++}});}finally{inTransaction=false;}
 }}};
 await assert.rejects(reserveGenerationAttempt(ref as never,'workspace-a','free_trial'),/hari ini tercapai/);
 assert.deepEqual(reads,['policy','usage']);assert.equal(writes,0);
});

test('normal plan cap, development status and missing counter initialization use the same policy',async()=>{
 const f=fake({count:undefined}); // default mock count6; explicit usage-empty adapter below
 const empty={collection:()=>({doc:()=>({get:async()=>({data:()=>undefined})})}),firestore:{collection:()=>({doc:()=>({get:async()=>({data:()=>undefined})})})}};
 assert.equal((await generationQuotaStatus(empty as never,'workspace-a','free_trial')).used,0);
 const d=fake({config:{workspaceId:'workspace-a',mode:'development',enabled:true},count:100});
 const status=await generationQuotaStatus(d.ref,'workspace-a','free_trial');assert.equal(status.mode,'development');assert.equal(status.dailyLimit,null);assert.equal(status.used,100);
 assert.deepEqual(await generationPolicy(f.ref,'workspace-a','starter_500k'),{mode:'standard',dailyLimit:3});
});

test('scheduled Reels recovers using the original WIB quota reservation even across midnight', async t => {
 t.mock.timers.enable({apis:['Date'], now:Date.parse('2026-11-12T16:59:00Z')});
 const usage = new Map([['2026-11-12',5],['2026-11-13',6]]);
 let job: {state:string; generationQuotaDay?:string} = { state: 'generating' };
 const jobRef = {};
 const policyRef = {};
 const ref = {
  collection: () => ({doc: (day: string) => day}),
  firestore: {
   collection: () => ({doc: () => policyRef}),
   runTransaction: async (action: (tx: unknown) => Promise<unknown>) => action({
    get: async (doc: unknown) => ({data: () => doc === jobRef ? job : typeof doc === 'string' ? {count:usage.get(doc)} : undefined}),
    update: (doc: unknown, update: Partial<typeof job>) => {assert.equal(doc, jobRef); job = {...job, ...update};},
    set: (day: string, value: {count:number}) => {usage.set(day, value.count);},
   }),
  },
 };
 const reserve = () => reserveGenerationAttempt(ref as never, 'workspace-a', 'free_trial', jobRef as never);
 assert.equal((await reserve()).used, 6);
 assert.equal(job.generationQuotaDay,'2026-11-12');
 assert.equal((await reserve()).used, 6);
 t.mock.timers.tick(120_000);
 assert.equal((await reserve()).day, '2026-11-12');
 await assert.rejects(reserveGenerationAttempt(ref as never, 'workspace-a', 'free_trial'), /hari ini tercapai/);
 job.state = 'cancelled';
 await assert.rejects(reserve(), /Slot Otonom sudah berubah/);
 assert.deepEqual([...usage], [['2026-11-12',6],['2026-11-13',6]]);
});
