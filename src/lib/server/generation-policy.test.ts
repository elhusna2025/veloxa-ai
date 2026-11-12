import test from 'node:test';
import assert from 'node:assert/strict';
import { generationPolicy, generationQuotaStatus, reserveGenerationAttempt } from './generation-policy';
function fake({ config, configError = false, count = 6, planData, workspaceData, actualPlan, beforeTransaction }:{
 config?:unknown; configError?:boolean; count?:unknown; planData?:unknown; workspaceData?:unknown;
 actualPlan?:string; beforeTransaction?:()=>void;
} = {}) {
 let value = count;
 let writes = 0;
 const reads:string[] = [];
 const usage = { get: async () => ({ data: () => ({ count:value }) }) };
 const ref = {
  get: async () => ({ data: () => ({ subscriptionPlanId:actualPlan }) }),
  collection: () => ({ doc: () => usage }),
  firestore: {
   collection: (name:string) => ({
    doc: (id:string) => ({
     get: async () => {
      reads.push(`${name}/${id}`);
      if (name === 'platform_configs' && configError) throw Error('unavailable');
      return { data: () => name === 'platform_configs' ? config : id === 'global' ? planData : workspaceData };
     },
    }),
   }),
   runTransaction: async (action:any) => {
    beforeTransaction?.();
    return action({get:(doc:any)=>doc.get(),set:(_ref:any,data:any)=>{writes++;value=data.count;}});
   },
  },
 };
 return {ref:ref as never,value:()=>value,writes:()=>writes,reads};
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
 const config = {workspaceId:'workspace-a',mode:'development',enabled:true};
 const f=fake({config,beforeTransaction:()=>{config.enabled=false;}});
 await assert.rejects(reserveGenerationAttempt(f.ref,'workspace-a','free_trial'),/hari ini tercapai/);
 assert.deepEqual(f.reads,['private_admin_settings/global','private_admin_settings/workspace_workspace-a','platform_configs/generation_workspace-a']);
 assert.equal(f.writes(),0);
});

test('normal plan cap, development status and missing counter initialization use the same policy',async()=>{
 const f=fake({count:undefined}); // default mock count6; explicit usage-empty adapter below
 const empty={collection:()=>({doc:()=>({get:async()=>({data:()=>undefined})})}),firestore:{collection:()=>({doc:()=>({get:async()=>({data:()=>undefined})})})}};
 assert.equal((await generationQuotaStatus(empty as never,'workspace-a','free_trial')).used,0);
 const d=fake({config:{workspaceId:'workspace-a',mode:'development',enabled:true},count:100});
 const status=await generationQuotaStatus(d.ref,'workspace-a','free_trial');assert.equal(status.mode,'development');assert.equal(status.dailyLimit,null);assert.equal(status.used,100);
 assert.deepEqual(await generationPolicy(f.ref,'workspace-a','starter_500k'),{mode:'standard',dailyLimit:3});
});

test('explicit workspace draft quota beats plan and legacy development; plan changes read current workspace package',async()=>{
 const planData={plans:{
  free_trial:{dailyDraftLimit:8,dailyPublicationLimit:null,monthlyPublicationLimit:20},
  starter_500k:{dailyDraftLimit:2,dailyPublicationLimit:null,monthlyPublicationLimit:20},
 }};
 const legacy={workspaceId:'workspace-a',mode:'development',enabled:true};
 const capped=fake({planData,config:legacy,workspaceData:{quota:{dailyDraftLimit:1}},count:1});
 await assert.rejects(reserveGenerationAttempt(capped.ref,'workspace-a','free_trial'),/hari ini tercapai/);
 assert.equal((await generationQuotaStatus(capped.ref,'workspace-a','free_trial')).dailyLimit,1);
 const legacyMode=fake({planData,config:legacy,count:8});
 assert.equal((await reserveGenerationAttempt(legacyMode.ref,'workspace-a','free_trial')).mode,'development');
 const exempt=fake({planData,workspaceData:{quota:{dailyDraftLimit:null}},count:9});
 assert.equal((await reserveGenerationAttempt(exempt.ref,'workspace-a','free_trial')).used,10);
 const current=fake({planData,actualPlan:'starter_500k',count:2});
 await assert.rejects(reserveGenerationAttempt(current.ref,'workspace-a','free_trial'),/hari ini tercapai/);
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
    get: async (doc: unknown) => ({data: () => doc === ref ? {subscriptionPlanId:'free_trial'} : doc === jobRef ? job : typeof doc === 'string' ? {count:usage.get(doc)} : undefined}),
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
