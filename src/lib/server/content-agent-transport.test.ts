import test from 'node:test';import assert from 'node:assert/strict';import{createManagedAgentTransport}from'./content-agent-transport';import{createContentAgentGenerator}from'./content-agent';import{BRAND_PRESETS}from'../veloxa-engine';
import type { ContentAgentCheckpointState } from './content-agent-transport';
import { studioGenerationCheckpoint } from './studio-generation-checkpoint';
const input={agent_id:'agent_test',environment:{type:'none' as const},input:'PRIVATE_PROMPT_SENTINEL',stream:true as const};
const final={type:'message',role:'assistant',phase:'final_answer',status:'completed',turn_id:'turn_test',content:[{type:'output_text',text:JSON.stringify({title:'Kenali bisnis',hook:'Layanan untuk Anda',caption:'Caption lengkap untuk diperiksa.',hashtags:['#Bisnis']})}]};
function fixture(config:{states?:string[];root?:Record<string,unknown>;items?:any[];more?:boolean;readFailures?:number;createError?:boolean;timeoutMs?:number}={}){let now=0,index=0,creates=0,lists=0,retrieves=0,reads=0,failures=config.readFailures||0;const logs:Record<string,unknown>[]=[];const root=()=>({id:'turn_test',session_id:'sess_test',agent_id:'agent_test',subagent_id:null,status:(config.states||['completed'])[Math.min(index++,((config.states||['completed']).length-1))],...config.root});const read=()=>{if(failures-->0)throw Object.assign(new Error('secret-provider-body'),{status:503});return root();};const client={beta:{agents:{retrieve:async()=>({model:'gpt-6-luna',tools:[]}),sessions:{create:async(body:any)=>{creates++;assert.equal(body.stream,false);assert.equal(body.input,input.input);if(config.createError)throw Object.assign(new Error('secret-provider-body'),{name:'APIConnectionTimeoutError'});return{id:'sess_test'};},turns:{list:async(session:string)=>{lists++;assert.equal(session,'sess_test');return{data:[read()]};},retrieve:async(turn:string,params:any)=>{retrieves++;assert.equal(turn,'turn_test');assert.equal(params.session_id,'sess_test');return read();},items:{list:async(turn:string,params:any)=>{reads++;assert.equal(turn,'turn_test');assert.equal(params.session_id,'sess_test');return{data:config.items||[{...final,role:'assistant',phase:'commentary'},final],hasNextPage:()=>!!config.more};}}}}}}};const adapter=createManagedAgentTransport(client as never,{now:()=>now,wait:async(ms)=>{now+=ms;},pollMs:1000,timeoutMs:config.timeoutMs??10000,log:event=>logs.push(event)});return{adapter,logs,counters:()=>({creates,lists,retrieves,reads})};}
test('managed agent creates exactly once and reads only the completed canonical root turn',async()=>{const f=fixture({states:['queued','in_progress','completed'],readFailures:1});const stream=await f.adapter.beta.agents.sessions.create(input);const a=stream.finalResult(),b=stream.finalResult();assert.equal(a,b);assert.equal(JSON.parse((await a).output_text).title,'Kenali bisnis');assert.deepEqual(f.counters(),{creates:1,lists:2,retrieves:2,reads:1});assert.deepEqual(f.logs,[]);stream.controller.abort();});
test('failed, cancelled, waiting and deadline never accept final-looking output or recreate paid input',async()=>{for(const [status,code]of[['failed','content_agent_failed'],['cancelled','content_agent_cancelled'],['waiting','content_agent_waiting'],['queued','content_agent_timeout']]){const f=fixture({states:[status],timeoutMs:2500});const stream=await f.adapter.beta.agents.sessions.create(input);await assert.rejects(stream.finalResult(),(e:any)=>e.code===code);assert.equal(f.counters().creates,1);assert.equal(f.counters().reads,0);assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_PROMPT_SENTINEL'));}});
test('ambiguous session creation is not retried and provider bodies never enter logs/errors',async()=>{const f=fixture({createError:true});const stream=await f.adapter.beta.agents.sessions.create(input);await assert.rejects(stream.finalResult(),(e:any)=>!e.message.includes('secret-provider-body')&&e.code==='content_agent_unavailable');assert.deepEqual(f.counters(),{creates:1,lists:0,retrieves:0,reads:0});assert.ok(!JSON.stringify(f.logs).includes('secret-provider-body'));});
test('foreign session/agent/turn, partial output and extra finals are rejected',async()=>{for(const config of[{root:{session_id:'sess_foreign'}},{root:{agent_id:'agent_foreign'}},{items:[{...final,turn_id:'turn_foreign'}]},{items:[{...final,status:'in_progress'}]},{items:[{...final,role:'user'}]},{items:[final,final]},{more:true},{items:[{...final,content:[{type:'output_text',text:'x'.repeat(48001)}]}]}]){const f=fixture(config);const stream=await f.adapter.beta.agents.sessions.create(input);await assert.rejects(stream.finalResult(),(e:any)=>/^invalid_content_agent_/.test(e.code));assert.equal(f.counters().creates,1);}});
test('durable transport output still passes the existing generator validation and Luna/tool guards',async()=>{const f=fixture();const adapter={...f.adapter,beta:{agents:{...f.adapter.beta.agents,sessions:{create:async(params:any)=>f.adapter.beta.agents.sessions.create({...params,input:input.input})}}}};const result=await createContentAgentGenerator(adapter,'agent_test')({brand:BRAND_PRESETS.cafe_fnb,format:'single_post',source:'manual_studio',vaultAssets:[],connections:[],planId:'free_trial'});assert.equal(result.draft.title,'Kenali bisnis');assert.equal(result.engineMode,'openai_live');assert.equal(f.counters().creates,1);});

test('checkpointed scripts continue the same canonical session after a polling deadline', async () => {
 let now = 0;
 let sessionCreates = 0;
 let canonicalReads = 0;
 let saved: ContentAgentCheckpointState | null = null;
 const writes: ContentAgentCheckpointState[] = [];
 const client = {
  beta: { agents: { sessions: {
   create: async () => { sessionCreates++; return { id: 'sess_checkpoint' }; },
   turns: {
    list: async () => ({ data: [{ id: 'turn_checkpoint', session_id: 'sess_checkpoint', agent_id: input.agent_id, subagent_id: null, status: 'queued' }] }),
    retrieve: async (turnId: string, params: { session_id: string }) => {
     assert.equal(turnId, 'turn_checkpoint');
     assert.equal(params.session_id, 'sess_checkpoint');
     canonicalReads++;
     return { id: turnId, session_id: params.session_id, agent_id: input.agent_id, subagent_id: null, status: canonicalReads < 3 ? 'in_progress' : 'completed' };
    },
    items: { list: async () => ({ data: [{ ...final, turn_id: 'turn_checkpoint' }], hasNextPage: () => false }) },
   },
  } } },
 };
 const adapter = createManagedAgentTransport(client as never, {
  checkpoint: {
   load: async () => saved,
   save: async value => { saved = { ...value }; writes.push(saved); },
  },
  timeoutMs: 2_500,
  pollMs: 1_000,
  now: () => now,
  wait: async milliseconds => { now += milliseconds; },
  log: () => {},
 });

 const first = await adapter.beta.agents.sessions.create(input);
 await assert.rejects(first.finalResult(), { code: 'content_agent_pending', status: 202 });
 assert.deepEqual(saved, { sessionId: 'sess_checkpoint', turnId: 'turn_checkpoint' });
 assert.equal(sessionCreates, 1);
 const resumed = await adapter.beta.agents.sessions.create(input);
 assert.equal(JSON.parse((await resumed.finalResult()).output_text).title, 'Kenali bisnis');
 assert.equal(sessionCreates, 1);
 assert.deepEqual(writes, [
  { sessionId: 'sess_checkpoint' },
  { sessionId: 'sess_checkpoint', turnId: 'turn_checkpoint' },
  { sessionId: 'sess_checkpoint', turnId: 'turn_checkpoint', completed: true },
 ]);
});

test('checkpointed scripts reject caller cancellation before returning any output', async () => {
 let saved: ContentAgentCheckpointState | null = { sessionId: 'sess_cancelled', turnId: 'turn_cancelled' };
 let stream: Awaited<ReturnType<ReturnType<typeof createManagedAgentTransport>['beta']['agents']['sessions']['create']>>;
 const client = {
  beta: { agents: { sessions: {
   create: async () => { throw new Error('Must never recreate an existing session'); },
   turns: { retrieve: async () => ({
    id: 'turn_cancelled', session_id: 'sess_cancelled', agent_id: input.agent_id, subagent_id: null, status: 'in_progress',
   }) },
  } } },
 };
 const adapter = createManagedAgentTransport(client as never, {
  checkpoint: { load: async () => saved, save: async value => { saved = value; } },
  wait: async () => { stream.controller.abort(); },
  log: () => {},
 });
 stream = await adapter.beta.agents.sessions.create(input);
 await assert.rejects(stream.finalResult(), { code: 'content_agent_timeout' });
 assert.equal(saved?.completed, undefined);
});

function studioCreationFixture(options: { retrieveFailsOnce?: boolean; creationReplyLost?: boolean; legacyIntent?: boolean } = {}) {
 const record: Record<string, unknown> = options.legacyIntent ? { scriptCreationStarted: true } : {};
 const writes: Record<string, unknown>[] = [];
 let preflightReads = 0;
 let paidCreates = 0;
 const rawClient = { beta: { agents: {
  retrieve: async () => {
   preflightReads++;
   if (options.retrieveFailsOnce && preflightReads === 1) throw Object.assign(new Error('private-preflight-body'), { status: 503 });
   return { model: 'gpt-6-luna', tools: [] };
  },
  sessions: {
   create: async () => {
    paidCreates++;
    assert.equal(record.scriptCreationStarted, true, 'the durable intent must precede a paid request');
    if (options.creationReplyLost) throw Object.assign(new Error('private-create-body'), { name: 'APIConnectionTimeoutError' });
    return { id: 'sess_test' };
   },
   turns: {
    list: async () => ({ data: [{ id: 'turn_test', session_id: 'sess_test', agent_id: 'agent_test', subagent_id: null, status: 'completed' }] }),
    items: { list: async () => ({ data: [final], hasNextPage: () => false }) },
   },
  },
 } } };
 const job = { get: async () => ({ data: () => ({ ...record }) }) };
 const checkpoint = studioGenerationCheckpoint(job as never, async () => {}, async values => {
  writes.push(values);
  Object.assign(record, values);
 }, undefined, {
  generate: async (params, generationOptions) => createContentAgentGenerator(createManagedAgentTransport(rawClient as never, {
   checkpoint: generationOptions?.checkpoint, log: () => {},
  }), 'agent_test')(params),
 });
 return { checkpoint, record, writes, counts: () => ({ preflightReads, paidCreates }) };
}

const studioParams = {
 brand: BRAND_PRESETS.cafe_fnb, format: 'single_post' as const, source: 'manual_studio' as const,
 vaultAssets: [], connections: [], planId: 'free_trial' as const,
};

test('read-only agent preflight failure leaves no creation intent and safely retries with one paid session', async () => {
 const fixture = studioCreationFixture({ retrieveFailsOnce: true });
 await assert.rejects(fixture.checkpoint.generate(studioParams), { status: 503, code: 'content_agent_unavailable' });
 assert.equal(fixture.record.scriptCreationStarted, undefined);
 assert.equal(fixture.record.agentSession, undefined);
 assert.deepEqual(fixture.counts(), { preflightReads: 1, paidCreates: 0 });
 const result = await fixture.checkpoint.generate(studioParams);
 assert.equal(result.draft.title, 'Kenali bisnis');
 assert.equal(fixture.record.scriptCreationStarted, true);
 assert.deepEqual(fixture.counts(), { preflightReads: 2, paidCreates: 1 });
 assert.equal(fixture.writes.filter(value => value.scriptCreationStarted === true).length, 1);
 const cached = await fixture.checkpoint.generate(studioParams);
 assert.equal(cached.draft.title, result.draft.title);
 assert.deepEqual(fixture.counts(), { preflightReads: 2, paidCreates: 1 });
});

test('lost paid session creation reply retains intent and never starts a replacement session', async () => {
 const fixture = studioCreationFixture({ creationReplyLost: true });
 const failed: unknown = await fixture.checkpoint.generate(studioParams).catch(error => error);
 assert.equal((failed as { code: string }).code, 'content_agent_unavailable');
 assert.doesNotMatch(JSON.stringify(failed), /private-create-body/);
 assert.equal(fixture.record.scriptCreationStarted, true);
 assert.equal(fixture.record.agentSession, undefined);
 await assert.rejects(fixture.checkpoint.generate(studioParams), { status: 503, code: 'content_agent_creation_uncertain' });
 assert.deepEqual(fixture.counts(), { preflightReads: 1, paidCreates: 1 });
 assert.equal(fixture.writes.filter(value => value.scriptCreationStarted === true).length, 1);
});

test('legacy creation intent without session remains conservatively blocked', async () => {
 const fixture = studioCreationFixture({ legacyIntent: true });
 await assert.rejects(fixture.checkpoint.generate(studioParams), { code: 'content_agent_creation_uncertain' });
 assert.deepEqual(fixture.counts(), { preflightReads: 0, paidCreates: 0 });
});

test('a checkpoint-load deadline prevents marking creation intent or making a paid request', async () => {
 let now = 0;
 let intents = 0;
 let creates = 0;
 const adapter = createManagedAgentTransport({ beta: { agents: { sessions: {
  create: async () => { creates++; return { id: 'sess_test' }; },
 } } } } as never, {
  checkpoint: {
   load: async () => { now = 1_000; return null; },
   beginCreation: async () => { intents++; },
   save: async () => {},
  },
  timeoutMs: 1_000, now: () => now, log: () => {},
 });
 const stream = await adapter.beta.agents.sessions.create(input);
 await assert.rejects(stream.finalResult(), { code: 'content_agent_timeout' });
 assert.equal(intents, 0);
 assert.equal(creates, 0);
});

test('resuming a checkpointed session never marks a new creation intent', async () => {
 let intents = 0;
 const adapter = createManagedAgentTransport({ beta: { agents: { sessions: {
  create: async () => { throw new Error('An existing paid session must never be replaced'); },
  turns: {
   retrieve: async () => ({ id: 'turn_test', session_id: 'sess_test', agent_id: input.agent_id, subagent_id: null, status: 'completed' }),
   items: { list: async () => ({ data: [final], hasNextPage: () => false }) },
  },
 } } } } as never, {
  checkpoint: {
   load: async () => ({ sessionId: 'sess_test', turnId: 'turn_test' }),
   beginCreation: async () => { intents++; }, save: async () => {},
  }, log: () => {},
 });
 const stream = await adapter.beta.agents.sessions.create(input);
 assert.equal(JSON.parse((await stream.finalResult()).output_text).title, 'Kenali bisnis');
 assert.equal(intents, 0);
});
