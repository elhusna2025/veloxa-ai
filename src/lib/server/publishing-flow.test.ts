import test from 'node:test';
import { profileFingerprint,jsonFingerprint } from '../profile-fingerprint';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createSocialContent } from './content';
import { analyzeBrandLogo } from './brand-palette';
import { loadContentReferences } from './content-references';
import type { ContentAgentParams } from './content-agent';
import type { SocialPostImageParams } from './content-image';
import { changeWorkspacePhotoState, listWorkspacePhotos, persistWorkspacePhoto, previewWorkspacePhoto } from './brand-assets';
import { publishSocialContent } from './publishing';
import { ApiError } from './http';
import { MetaRequestError } from './meta-graph';
import { BRAND_PRESETS, generateBrandContentDraft, SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { wibMonth } from './clock';

/** Transactional in-memory Firebase test adapter. No Firebase/Meta network calls occur. */
class Database {
  values = new Map<string, Record<string, any>>();
  tail = Promise.resolve();
  failReceiptWrite = false;
  collection(name: string) { return new Collection(this, name); }
  write(ref: Doc, data: Record<string, any>, merge = true) {
    const result = merge ? structuredClone(this.values.get(ref.path) || {}) : {};
    for (const [key, value] of Object.entries(data)) {
      const keys = key.split('.'); let target = result;
      for (const part of keys.slice(0, -1)) target = target[part] ||= {};
      target[keys.at(-1)!] = structuredClone(value);
    }
    this.values.set(ref.path, result);
  }
  async runTransaction<T>(action: (tx: any) => Promise<T>): Promise<T> {
    const previous = this.tail; let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const operations: (() => void)[] = [];
    const tx = { get: (ref: Doc) => ref.get(), getAll: (...refs: Doc[]) => Promise.all(refs.map(ref => ref.get())),
      create: (ref: Doc, data: any) => operations.push(() => {assert.equal(this.values.has(ref.path),false);this.write(ref,data,false);}),
      set: (ref: Doc, data: any, options?: { merge?: boolean }) => operations.push(() => this.write(ref, data, options?.merge)),
      delete:(ref:Doc)=>operations.push(()=>this.values.delete(ref.path)),
      update: (ref: Doc, data: any) => operations.push(() => this.write(ref, data)) };
    try { const result = await action(tx); operations.forEach(operation => operation()); return result; }
    finally { release(); }
  }
}
class Collection {
  constructor(public database: Database, public path: string) {}
  doc(id: string) { return new Doc(this.database, `${this.path}/${id}`); }
  orderBy(key:string,direction:'asc'|'desc'='asc'){return{limit:(count:number)=>({get:async()=>({docs:(await this.get()).docs.sort((a,b)=>((a.data()?.[key]||0)-(b.data()?.[key]||0))*(direction==='asc'?1:-1)).slice(0,count)})})};}
  limit(count: number) { return { get: async () => ({ docs: (await this.get()).docs.slice(0,count) }) }; }
  where(key:string,_operator:string,value:unknown){return{limit:(count:number)=>({get:async()=>({docs:(await this.get()).docs.filter(doc=>doc.data()?.[key]===value).slice(0,count)})})};}
  async get() {
    const docs = [...this.database.values.keys()].filter(key => key.startsWith(this.path + '/') && !key.slice(this.path.length + 1).includes('/')).map(key => new Doc(this.database, key));
    return { docs: await Promise.all(docs.map(ref => ref.get())) };
  }
}
class Doc {
  constructor(public firestore: Database, public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new Collection(this.firestore, `${this.path}/${name}`); }
  async get() { const data = this.firestore.values.get(this.path); return { id: this.id, ref: this, exists: !!data, data: () => data ? structuredClone(data) : undefined }; }
  async create(data: any) { assert.equal(this.firestore.values.has(this.path), false); this.firestore.write(this, data, false); }
  async update(data: any) {
    if (this.firestore.failReceiptWrite && this.path.includes('/publish_jobs/') && data.receipts) throw new Error('simulated database disconnect');
    this.firestore.write(this, data);
  }
}

// Publishing tests use the agent's short visual-copy contract; captions remain detailed.
function shortVisualDraft(input: ContentAgentParams) {
 const draft=generateBrandContentDraft(input);
 if(input.format==='single_post'){
  draft.title=`Kenali ${input.brand.businessName}`;
  draft.hook='Kenali layanan dan informasi terbaru bisnis ini.';
  if(draft.slides?.[0])draft.slides[0]={...draft.slides[0],headline:draft.title,body:draft.hook};
 }
 return draft;
}

function fixture() {
  const database = new Database(); const ref = database.collection('workspaces').doc('workspace-a');
  database.values.set(ref.path, { ownerUid: 'customer-a', memberUids: [], subscriptionPlanId: 'free_trial', quotaUsed: 0,
    snapshotJson: JSON.stringify({ brand: { ...BRAND_PRESETS.cafe_fnb, workspaceId: ref.id } }) });
  for (const channel of ['facebook', 'instagram']) database.values.set(`${ref.path}/private_meta_connections/${channel}`, { channel, accountId: channel === 'facebook' ? '100' : '200', pageId: '100', accountName: 'Test account', handle: '@test', encryptedToken: 'test-ciphertext', expiresAt: Date.now() + 60_000 });
  const blobs = new Map<string, Buffer>();
  const storage = { name: 'test-bucket', file: (key: string) => ({ save: async (bytes: Buffer) => { blobs.set(key, bytes); }, download: async () => { const value = blobs.get(key); if (!value) throw new Error('missing media'); return [value]; } }) };
  const authorize = async (_request: Request, workspaceId: unknown) => {
    if (workspaceId !== ref.id) throw new ApiError(403, 'Forbidden workspace');
    return { ref, user: { uid: 'customer-a' }, workspaceId: ref.id, workspace: (await ref.get()).data()! };
  };
  let renderCalls = 0;
  let generateCalls = 0;
  const create = async (options: {
    format?: 'single_post' | 'carousel';
    topic?: string;
    sourceMode?:'manual'|'offerings';offeringIds?:string[];contentIntent?:'auto'|'education'|'introduction'|'promotion';
    selectedConnectionIds?:string[];
    businessId?:string;
    sourceAssetId?: string;
    source?: 'autonomous_agent';
    referenceAssetIds?: string[];
    referenceInstruction?: string;
    carouselPlan?: import('../carousel-plan').CarouselPlan;
    referenceRoles?:import('../content-reference-roles').ContentReferenceRoles;
    onProgress?: (event: { stage: string }) => void;
    generate?: (input: ContentAgentParams) => Promise<{ draft: ReturnType<typeof generateBrandContentDraft>; engineMode: 'deterministic_local' }>;
    renderImage?: (params: SocialPostImageParams) => Promise<Buffer>;
    verifyArtwork?: NonNullable<Parameters<typeof createSocialContent>[1]>['verifyArtwork'];
  } = {}) => createSocialContent(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, businessId:options.businessId, selectedConnectionIds:options.selectedConnectionIds, referenceRoles:options.referenceRoles, expectedProfileFingerprint: await profileFingerprint(options.businessId&&options.businessId!=='primary'?database.values.get(`${ref.path}/business_contexts/${options.businessId}`)?.brand||JSON.parse(database.values.get(ref.path)!.snapshotJson).brand:JSON.parse(database.values.get(ref.path)!.snapshotJson).brand), topic: options.topic ?? 'Promo akhir pekan',sourceMode:options.sourceMode,offeringIds:options.offeringIds,contentIntent:options.contentIntent, format: options.format || 'single_post', ...(options.sourceAssetId ? { sourceAssetId: options.sourceAssetId } : {}), referenceAssetIds: options.referenceAssetIds, referenceInstruction: options.referenceInstruction, carouselPlan: options.carouselPlan }) }), {
    authorize: authorize as never, storage: storage as never, onProgress: options.onProgress, source:options.source, verifyArtwork:options.verifyArtwork, verifyScript: async () => {},
    generate: async input => {
      generateCalls++;
      if (options.generate) return options.generate(input);
      const draft = shortVisualDraft(input);
      if (input.format === 'carousel') draft.slides = Array.from({ length: 5 }, (_, index) => ({ slideNumber: index + 1, headline: `Headline ${index + 1}`, body: `Body ${index + 1}`, visualDirection: 'Visual direction', badgeText: `${index + 1}/5` }));
      return { draft, engineMode: 'deterministic_local' };
    },
    renderImage: options.renderImage || (async () => {
      renderCalls++;
      return sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    }),
  });
  const dependencies = { authorize: authorize as never, database: database as never, storage: storage as never, decrypt: (_value: string, workspaceId: string) => { assert.equal(workspaceId, ref.id); return 'test-token'; } };
  const request = (draftId: string) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, draftId }) });
  const count = () => [...database.values.entries()].find(([key]) => key.includes('/publish_usage/'))?.[1].count || 0;
  const generationCount = () => [...database.values.entries()].find(([key]) => key.includes('/generation_usage/'))?.[1].count || 0;
  return { database, ref, blobs, create, dependencies, request, count, generationCount, authorize, generateCalls: () => generateCalls, renderCalls: () => renderCalls };
}

async function blendFixture(){const f=fixture();const photo=await seedPhoto(f);const body={workspaceId:f.ref.id,businessId:'primary',expectedProfileFingerprint:await profileFingerprint(JSON.parse(f.database.values.get(f.ref.path)!.snapshotJson).brand),referenceAssetIds:[photoId],referenceRoles:{[photoId]:'visual'},format:'carousel',topic:'',existingInstruction:'Presentasikan produk di kafe',sourceMode:'manual',offeringIds:[],contentIntent:'education'};return{...f,photo,body,blendRequest:(extra={})=>new Request('http://local/api',{method:'POST',body:JSON.stringify({...body,...extra})})};}
const blendAnswer={instruction:'Gunakan Ref 1 sebagai acuan adegan presentasi produk. Buat lima slide dengan fokus berbeda.',observations:[{refNumber:1,kind:'product',description:'Objek produk pada latar netral.'}],warnings:[]};
test('blend reads actual private image bytes in selection order and saved product focus without changing data',async()=>{const{analyzeReferenceBlend}=await import('./reference-blend');const f=await blendFixture();const record=f.database.values.get(f.ref.path)!;const snap=JSON.parse(record.snapshotJson);snap.brand.offerings=[{id:'erp',title:'ERP',highlight:'Laporan arus kas',category:'service',priceLabel:''},{id:'pos',title:'POS',highlight:'Transaksi',category:'service',priceLabel:''}];record.snapshotJson=JSON.stringify(snap);f.body.expectedProfileFingerprint=await profileFingerprint(snap.brand);const otherId='123e4567-e89b-42d3-a456-426614174001';const otherPath=`workspaces/${f.ref.id}/vault/${otherId}.jpg`;f.database.values.set(`${f.ref.path}/server_assets/${otherId}`,{asset:{...f.photo.asset,id:otherId,title:'Lokasi kafe'},storagePath:otherPath});const otherBytes=await sharp({create:{width:300,height:200,channels:3,background:'blue'}}).jpeg().toBuffer();f.blobs.set(otherPath,otherBytes);const before=JSON.stringify([...f.database.values]);let calls=0;const result=await analyzeReferenceBlend(f.blendRequest({sourceMode:'offerings',offeringIds:['erp'],referenceAssetIds:[otherId,photoId],referenceRoles:{[otherId]:'visual',[photoId]:'visual'}}),{authorize:f.authorize as never,storage:f.dependencies.storage,suggest:async brief=>{calls++;assert.equal(brief.business.offerings instanceof Array,true);assert.deepEqual((brief.business.offerings as any[]).map(p=>p.id),['erp']);assert.match(brief.topic,/ERP/);assert.equal(brief.references[0].title,'Lokasi kafe');assert.deepEqual(brief.references[0].bytes,otherBytes);assert.deepEqual(brief.references[1].bytes,f.blobs.get(f.photo.storagePath));assert.equal(brief.existingInstruction,f.body.existingInstruction);return{...blendAnswer,instruction:'Gunakan Ref 1 sebagai lokasi dan Ref 2 sebagai produk.',observations:[blendAnswer.observations[0],{...blendAnswer.observations[0],refNumber:2}]};}});assert.equal(calls,1);assert.deepEqual(result.observations.map(r=>r.assetId),[otherId,photoId]);assert.equal(JSON.stringify([...f.database.values]),before);assert.equal(f.generationCount(),0);assert.equal(f.count(),0);});
test('blend rewrites an unfinished AI suggestion once before returning the complete text', async () => {
 const {analyzeReferenceBlend} = await import('./reference-blend');
 const f = await blendFixture();
 const stages: string[] = [];
 const attempts: boolean[] = [];
 const result = await analyzeReferenceBlend(f.blendRequest(), {
  authorize:f.authorize as never,
  storage:f.dependencies.storage,
  progress: stage => stages.push(stage),
  suggest: async (_brief, options) => {
   attempts.push(options.rewrite);
   return options.rewrite ? blendAnswer : {...blendAnswer, instruction:'Gunakan Ref 1 untuk presentasi dan jangan tampil'};
  },
 });
 assert.deepEqual(attempts, [false, true]);
 assert.deepEqual(stages, ['validation', 'references', 'analysis', 'rewrite', 'review']);
 assert.equal(result.instruction, blendAnswer.instruction);
 assert.equal(f.generationCount(), 0);
 assert.equal(f.database.values.has(`${f.ref.path}/reference_blend_jobs/primary`), false);
});
const reviewedSlides = Array.from({ length: 5 }, (_, index) => ({
 headline: `Judul pilihan ${index + 1}`, body: 'Satu pesan yang sudah ditinjau.', visualDirection: `Adegan pilihan ${index + 1}`,
}));

test('carousel planning works with actual reference images or no references, without draft or quota writes', async () => {
 const {analyzeReferenceBlend} = await import('./reference-blend');
 for (const withReferences of [false, true]) {
  const f = await blendFixture();
  const input = withReferences ? {} : {referenceAssetIds: [], referenceRoles: {}};
  const before = structuredClone([...f.database.values]);
  const proposal = await analyzeReferenceBlend(f.blendRequest(input), {
   authorize: f.authorize as never,
   storage: f.dependencies.storage,
   suggest: async (brief, options) => {
    assert.equal(options.carouselPlan, true);
    assert.equal(brief.references.length, Number(withReferences));
    if (withReferences) assert.deepEqual(brief.references[0].bytes, f.blobs.get(f.photo.storagePath));
    return {
     topic: 'Topik usulan', visualDirection: 'Suasana kafe terang',
     slides: reviewedSlides.map((slide, index) => ({...slide, refNumbers: withReferences && index === 2 ? [1] : []})),
    };
   },
  }, true);
  assert.deepEqual(proposal.slides.map(slide => slide.assetIds), [[], [], withReferences ? [photoId] : [], [], []]);
  assert.equal(proposal.topic, 'Topik usulan');
  assert.deepEqual([...f.database.values], before);
  assert.equal(f.generationCount(), 0);
 }
});

test('blend rejects stale/foreign/trashed/duplicate/missing or unassigned refs before AI',async()=>{const{analyzeReferenceBlend}=await import('./reference-blend');for(const invalid of['profile','business','trash','duplicate','missing','roles','workspace','offering']as const){const f=await blendFixture();let calls=0;const extra:any={};if(invalid==='profile')extra.expectedProfileFingerprint='0'.repeat(64);if(invalid==='business')f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!.asset.businessId='b_foreign';if(invalid==='trash')f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!.trashedAt=1;if(invalid==='duplicate')extra.referenceAssetIds=[photoId,photoId];if(invalid==='missing')f.database.values.delete(`${f.ref.path}/server_assets/${photoId}`);if(invalid==='roles')extra.referenceRoles={};if(invalid==='workspace')extra.workspaceId='foreign-workspace';if(invalid==='offering'){extra.sourceMode='offerings';extra.offeringIds=['foreign'];}await assert.rejects(analyzeReferenceBlend(f.blendRequest(extra),{authorize:f.authorize as never,storage:f.dependencies.storage,suggest:async()=>{calls++;return blendAnswer;}}));assert.equal(calls,0);assert.equal([...f.database.values.keys()].some(k=>k.includes('/reference_blend_jobs/')),false);}});
test('blend discards response after profile/metadata/storage/membership changes and releases lease',async()=>{const{analyzeReferenceBlend}=await import('./reference-blend');for(const mutation of['profile','metadata','storage','membership','trash','malformed']as const){const f=await blendFixture();await assert.rejects(analyzeReferenceBlend(f.blendRequest(),{authorize:f.authorize as never,storage:f.dependencies.storage,suggest:async()=>{const record=f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!;if(mutation==='metadata')record.asset.metadataRevision=1;if(mutation==='storage')record.storagePath=record.storagePath.replace(photoId,'123e4567-e89b-42d3-a456-426614174001');if(mutation==='trash')record.trashedAt=1;if(mutation==='membership')f.database.values.get(f.ref.path)!.ownerUid='another-owner';if(mutation==='profile'){const ws=f.database.values.get(f.ref.path)!;const snap=JSON.parse(ws.snapshotJson);snap.brand.businessName='Changed';ws.snapshotJson=JSON.stringify(snap);}return mutation==='malformed'?{...blendAnswer,instruction:'Does not cover any Ref'}:blendAnswer;}}));assert.equal(f.database.values.has(`${f.ref.path}/reference_blend_jobs/primary`),false);assert.equal(f.generationCount(),0);assert.equal(f.count(),0);}});
test('blend prevents concurrent analysis for same business and cleans provider failures',async()=>{const{analyzeReferenceBlend}=await import('./reference-blend');const f=await blendFixture();let calls=0,release!:()=>void;const gate=new Promise<void>(r=>release=r);const deps={authorize:f.authorize as never,storage:f.dependencies.storage,suggest:async()=>{calls++;await gate;return blendAnswer;}};const first=analyzeReferenceBlend(f.blendRequest(),deps);while(!calls)await new Promise(r=>setImmediate(r));await assert.rejects(analyzeReferenceBlend(f.blendRequest(),deps),/masih berjalan/);release();await first;assert.equal(calls,1);await assert.rejects(analyzeReferenceBlend(f.blendRequest(),{...deps,suggest:async()=>{throw new Error('provider failed');}}));assert.equal(f.database.values.has(`${f.ref.path}/reference_blend_jobs/primary`),false);});

test('product focus reaches generation and render for single/carousel, invalid product consumes no quota',async()=>{
 for(const format of ['single_post','carousel']as const){const f=fixture();const record=f.database.values.get(f.ref.path)!;const snap=JSON.parse(record.snapshotJson);snap.brand.offerings=[{id:'erp',title:'Cloud ERP',highlight:'Laporan arus kas',category:'service',priceLabel:''},{id:'pos',title:'Kasir POS',highlight:'Transaksi toko',category:'product',priceLabel:''}];record.snapshotJson=JSON.stringify(snap);
  await assert.rejects(f.create({sourceMode:'offerings',offeringIds:['foreign'],topic:'',format}));assert.equal(f.generationCount(),0);assert.equal(f.generateCalls(),0);
  let generated:any;const result=await f.create({sourceMode:'offerings',offeringIds:['erp'],contentIntent:'education',topic:'',format,generate:async input=>{generated=input;const draft=shortVisualDraft(input);if(format==='carousel')draft.slides=Array.from({length:5},(_,i)=>({slideNumber:i+1,headline:'Laporan arus kas',body:'ERP untuk bisnis',visualDirection:'Pemilik usaha membaca laporan',badgeText:`${i+1}/5`}));return{draft,engineMode:'deterministic_local'};},renderImage:async input=>{assert.ok(JSON.stringify(input.businessContext).includes('Laporan arus kas'));return sharp({create:{width:1080,height:1350,channels:3,background:'white'}}).jpeg().toBuffer();}});
  assert.deepEqual(generated.brand.offerings.map((item:any)=>item.id),['erp']);assert.deepEqual(generated.offeringFocus,{ids:['erp'],intent:'education'});assert.deepEqual(result.draft.contentSource?.offeringIds,['erp']);assert.equal(JSON.parse(record.snapshotJson).brand.offerings.length,2);
 }
});

test('profile analysis rejects foreign accounts/stale profile and uses lease; never writes profile or quota',async()=>{
 const {analyzeSocialBrand}=await import('./brand-analysis');const f=fixture();f.database.values.set(`${f.ref.path}/business_contexts/primary`,{revision:1,connectionIds:['instagram_200']});const original=f.database.values.get(f.ref.path)!.snapshotJson;
 const body={workspaceId:f.ref.id,businessId:'primary',profileFingerprint:await profileFingerprint(JSON.parse(original).brand),connectionIds:['instagram_200']};const request=(extra={})=>new Request('http://localhost/api',{method:'POST',body:JSON.stringify({...body,...extra})});let calls=0;let release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);const dependencies={authorize:f.authorize as never,collect:async()=>{calls++;await wait;return{sources:[{id:'p',kind:'profile' as const,label:'Profil',text:'Sistem ERP'}],images:[],warnings:[],websites:[]};},suggest:async()=>({suggestions:[],warnings:[]})};
 await assert.rejects(analyzeSocialBrand(request({connectionIds:['facebook_100']}),dependencies),/bisnis ini/);await assert.rejects(analyzeSocialBrand(request({profileFingerprint:'0'.repeat(64)}),dependencies),/berubah/);assert.equal(calls,0);
 const first=analyzeSocialBrand(request(),dependencies);while(!calls)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(analyzeSocialBrand(request(),dependencies),/masih berjalan/);release();const result=await first;assert.equal(result.businessId,'primary');assert.equal(f.database.values.get(f.ref.path)!.snapshotJson,original);assert.equal(f.generationCount(),0);assert.equal(f.count(),0);assert.equal(f.database.values.has(`${f.ref.path}/profile_analysis_jobs/primary`),false);
});

test('profile analysis discards suggestions when ownership/account mapping changes during provider work',async()=>{
 const {analyzeSocialBrand}=await import('./brand-analysis');for(const change of ['owner','mapping','token']as const){const f=fixture();f.database.values.set(`${f.ref.path}/business_contexts/primary`,{revision:1,connectionIds:['instagram_200']});const request=new Request('http://localhost/api',{method:'POST',body:JSON.stringify({workspaceId:f.ref.id,businessId:'primary',profileFingerprint:await profileFingerprint(JSON.parse(f.database.values.get(f.ref.path)!.snapshotJson).brand),connectionIds:['instagram_200']})});let ai=0;
 await assert.rejects(analyzeSocialBrand(request,{authorize:f.authorize as never,collect:async()=>{if(change==='owner')f.database.values.get(f.ref.path)!.ownerUid='other';else if(change==='mapping')f.database.values.get(`${f.ref.path}/business_contexts/primary`)!.connectionIds=[];else f.database.values.get(`${f.ref.path}/private_meta_connections/instagram`)!.encryptedToken='changed';return{sources:[{id:'p',kind:'profile',label:'Bio',text:'Sistem ERP'}],images:[],warnings:[],websites:[]};},suggest:async()=>{ai++;return{suggestions:[],warnings:[]};}}));assert.equal(ai,0);assert.equal(f.generationCount(),0);}
});

test('operation retry is single-shot and recovers persisted draft after completion update or connection loss',async()=>{
 const {prepareContentOperation,readContentOperation}=await import('./content-operation');const f=fixture();const operationId='123e4567-e89b-42d3-a456-426614174099';const body={workspaceId:f.ref.id,businessId:'primary',operationId,format:'carousel',topic:'',referenceAssetIds:[]};const request=()=>new Request('http://localhost/api',{method:'POST',body:JSON.stringify(body)});let calls=0;const draft={id:'draft_recovery',workspaceId:f.ref.id,businessId:'primary',format:'carousel',renderedMedia:{url:'/cover.jpg'},renderedSlides:Array.from({length:5},()=>({url:'/slide.jpg'}))};
 const create=(async(_request:any,deps:any)=>{calls++;deps.onProgress({stage:'script'});deps.onProgress({stage:'saving'});f.database.values.set(`${f.ref.path}/social_drafts/${draft.id}`,{draft,operationId,engineMode:'openai_live'});return{draft,engineMode:'openai_live'};})as never;
 const first=await prepareContentOperation(request(),{authorize:f.authorize as never,create});assert.equal(first.start,true);const replay=await prepareContentOperation(request(),{authorize:f.authorize as never,create});assert.equal(replay.start,false);await first.run(()=>{});assert.equal(calls,1);const recovered=await readContentOperation(request(),f.ref.id,'primary',operationId,{authorize:f.authorize as never});assert.equal(recovered.state,'complete');assert.equal(recovered.result?.draft.id,draft.id);const {operationId:omitted,...originalInput}=body;await assert.rejects(readContentOperation(request(),f.ref.id,'primary',operationId,{authorize:f.authorize as never,expectedInputFingerprint:await jsonFingerprint({...originalInput,topic:'New request'})}),/permintaan berbeda/);assert.equal((await readContentOperation(request(),f.ref.id,'primary',operationId,{authorize:f.authorize as never,expectedInputFingerprint:await jsonFingerprint(originalInput)})).state,'complete');
 const job=f.database.values.get(`${f.ref.path}/generation_jobs/${operationId}`)!;delete job.draftId;job.state='running';const fallback=await readContentOperation(request(),f.ref.id,'primary',operationId,{authorize:f.authorize as never});assert.equal(fallback.result?.draft.id,draft.id);assert.equal(calls,1);await assert.rejects(prepareContentOperation(new Request('http://localhost/api',{method:'POST',body:JSON.stringify({...body,topic:'Different'})}),{authorize:f.authorize as never,create}),/permintaan lain/);
});

test('empty manual topic and no references still generate five contextual slides with saved DNA',async()=>{const f=fixture();const ws=f.database.values.get(f.ref.path)!;const snap=JSON.parse(ws.snapshotJson);snap.brand.businessDescription='Berez ERP untuk pengelolaan stok dan keuangan';snap.brand.useBrandPalette=true;snap.brand.primaryColorHex='#0061AD';snap.brand.accentColorHex='#FFFFFF';ws.snapshotJson=JSON.stringify(snap);let renders=0;const result=await f.create({topic:'',format:'carousel',referenceAssetIds:[],renderImage:async input=>{renders++;assert.equal(input.businessContext?.description,snap.brand.businessDescription);assert.deepEqual(input.brandPalette,['#0061AD','#FFFFFF']);return sharp({create:{width:1080,height:1350,channels:3,background:'#0061AD'}}).jpeg().toBuffer();}});assert.equal(renders,5);assert.equal(result.draft.renderedSlides?.length,5);assert.equal(f.generationCount(),1);});

async function autonomyFixture(){
 const {updateAutonomy,ruleKey}=await import('./autonomy-api');const f=fixture();const ws=f.database.values.get(f.ref.path)!;const snap=JSON.parse(ws.snapshotJson);snap.brand.businessDescription='Sistem ERP untuk pengelolaan bisnis';ws.snapshotJson=JSON.stringify(snap);f.database.values.set(`${f.ref.path}/business_contexts/primary`,{revision:1,connectionIds:['instagram_200']});for(const[key,record]of f.database.values)if(key.includes('/private_meta_connections/'))record.expiresAt=0;
 const config={connectionIds:['instagram_200'],days:['Sen','Sel','Rab','Kam','Jum','Sab','Min'],timesWib:['08:00'],sourceMode:'profile',offeringIds:[],topics:[],intent:'education',formats:['single_post'],referenceAssetIds:[],referenceRoles:{},referenceInstruction:'',directions:''};const request=(action:string,expectedRevision:number,extra={})=>new Request('http://localhost/api',{method:'PATCH',body:JSON.stringify({workspaceId:f.ref.id,businessId:'primary',action,expectedRevision,...extra})});const deps={authorize:f.authorize as never,database:f.database as never,health:async()=>({schedulerReady:true,lastTickAt:Date.now()})};
 const saved=await updateAutonomy(request('save',0,{config}),deps);assert.equal(saved.rule?.enabled,false);await updateAutonomy(request('activate',1),deps);const ruleRef=f.database.collection('auto_content_rules').doc(ruleKey(f.ref.id,'primary'));const rule=f.database.values.get(ruleRef.path)!;rule.nextSlotMs=Date.now()-1000;rule.nextDueMs=rule.nextSlotMs;return{...f,config,rule,ruleRef,request,autoDeps:deps,updateAutonomy};
}

test('autonomy owner API validates configuration/health/revision and saving never activates',async()=>{const f=await autonomyFixture();await assert.rejects(f.updateAutonomy(f.request('save',2,{config:{...f.config,connectionIds:['facebook_100']}}),f.autoDeps),/bukan milik/);await assert.rejects(f.updateAutonomy(f.request('activate',2),{...f.autoDeps,health:async()=>({schedulerReady:false,lastTickAt:null})}),/belum terhubung/);await assert.rejects(f.updateAutonomy(f.request('pause',1),f.autoDeps),/tab lain/);f.database.values.get(f.ref.path)!.ownerUid='other';await assert.rejects(f.updateAutonomy(f.request('pause',2),f.autoDeps),/pemilik/);});

test('autonomy concurrent ticks claim once and use server generation/publisher with owner authorization',async()=>{const{processAutonomyRule}=await import('./autonomy-worker');const f=await autonomyFixture();let creates=0,publishes=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const deps={database:f.database as never,create:(async(request:Request,options:any)=>{creates++;const input=await request.json();assert.equal(input.workspaceId,f.ref.id);assert.equal(input.businessId,'primary');assert.equal(options.source,'autonomous_agent');await options.authorize(request,f.ref.id);await gate;return{draft:{id:'draft_auto',title:'Arus kas usaha'}};})as never,publish:(async(request:Request,options:any)=>{publishes++;await options.authorize(request,f.ref.id);return{draft:{status:'published'},receipts:[{channel:'instagram',status:'published'}],quotaUsed:1};})as never};
 const first=processAutonomyRule(f.ruleRef as never,deps);while(!creates)await new Promise(resolve=>setImmediate(resolve));assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'idle');release();assert.equal((await first).state,'published');assert.equal(creates,1);assert.equal(publishes,1);assert.equal(f.database.values.get(f.ruleRef.path)!.enabled,true);assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'idle');assert.equal(creates,1);
});

test('autonomy stops publication on pause, profile change, moved account, owner change and exhausted quota',async()=>{const{processAutonomyRule}=await import('./autonomy-worker');for(const change of['pause','profile','account','owner','quota']as const){const f=await autonomyFixture();let creates=0,publishes=0;if(change==='quota')f.database.values.set(`${f.ref.path}/publish_usage/${wibMonth()}`,{count:SUBSCRIPTION_PLANS.free_trial.monthlyPostQuota});const result=await processAutonomyRule(f.ruleRef as never,{database:f.database as never,create:(async()=>{creates++;if(change==='pause'){const rule=f.database.values.get(f.ruleRef.path)!;rule.enabled=false;rule.revision++;}if(change==='owner')f.database.values.get(f.ref.path)!.ownerUid='other';if(change==='account')f.database.values.get(`${f.ref.path}/business_contexts/primary`)!.connectionIds=[];if(change==='profile'){const ws=f.database.values.get(f.ref.path)!;const value=JSON.parse(ws.snapshotJson);value.brand.businessDescription='Changed';ws.snapshotJson=JSON.stringify(value);}return{draft:{id:'draft_auto',title:'Uji'}};})as never,publish:(async()=>{publishes++;return{draft:{status:'published'},receipts:[]};})as never});assert.notEqual(result.state,'published');assert.equal(publishes,0);assert.equal(creates,change==='quota'?0:1);assert.equal(f.database.values.get(f.ruleRef.path)!.enabled,false);assert.equal(f.database.values.get(f.ruleRef.path)!.processingJob,null);}});

test('autonomy resumes only confirmed queued draft; unknown delivery is paused and never regenerated',async()=>{const{processAutonomyRule}=await import('./autonomy-worker');for(const unknown of[false,true]){const f=await autonomyFixture();let creates=0,publishes=0,clock=Date.now();const deps={database:f.database as never,now:()=>clock,create:(async()=>{creates++;return{draft:{id:'draft_auto',title:'Uji'}};})as never,publish:(async()=>{publishes++;return{hasMore:!unknown&&publishes===1,draft:{status:unknown?'needs_attention':publishes===1?'publish_queued':'published'},receipts:[]};})as never};const first=await processAutonomyRule(f.ruleRef as never,deps);assert.equal(first.state,unknown?'needs_attention':'queued');clock+=61000;const last=await processAutonomyRule(f.ruleRef as never,deps);assert.equal(last.state,unknown?'inactive':'published');assert.equal(creates,1);assert.equal(publishes,unknown?1:2);}});

test('autonomy keeps recovering a rejected Reels slot with the same draft key and publishes once', async () => {
 const {processAutonomyRule}=await import('./autonomy-worker');
 const {GenerationStageError}=await import('./content-generation-stream');
 const firstSlot=Date.parse('2026-11-12T05:00:00Z');
 const secondSlot=Date.parse('2026-11-12T06:00:00Z');
 for(const rejectLast of [false,true]){
  const f=await autonomyFixture();
  let clock=firstSlot+1000;
  const created:string[]=[];
  const reelsRecovery:(string|undefined)[]=[];
  const reelDraftKeys:string[]=[];
  let published=0;
  Object.assign(f.rule,{config:{...f.config,days:['Kam'],timesWib:['12:00','13:00'],formats:['carousel','short_video'],endsOnWib:'2026-11-12'},nextSlotMs:firstSlot,nextDueMs:firstSlot});
  const deps={
   database:f.database as never,
   now:()=>clock,
   create:(async(request:Request,options:Parameters<typeof createSocialContent>[1])=>{
    const {format}=await request.json();
    created.push(format);
    if(format==='short_video') {
      reelsRecovery.push(options?.recoverScheduledReelsArtwork);
      reelDraftKeys.push(options!.scheduledDraft!.id);
    }
    if(format==='carousel'||reelsRecovery.length<3||rejectLast)throw new GenerationStageError(new ApiError(422,'Visual otomatis perlu diperiksa.','scheduled_artwork_rejected'),'compositing');
    return{draft:{id:options!.scheduledDraft!.id,title:'Arus kas'}};
   })as never,
   publish:(async()=>{published++;return{draft:{status:'published'},receipts:[]};})as never,
  };
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'retry_generation');
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'idle');
  clock+=120_000;
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'failed');
  const firstJob=f.database.values.get(`${f.ruleRef.path}/jobs/slot_${firstSlot}`)!;
  assert.equal(firstJob.state,'failed');
  assert.deepEqual(firstJob.generationFailure,{stage:'compositing',code:'scheduled_artwork_rejected'});
  assert.equal(firstJob.draftId,undefined);
  const afterFirst=f.database.values.get(f.ruleRef.path)!;
  assert.equal(afterFirst.enabled,true);
  assert.equal(afterFirst.nextDueMs,secondSlot);
  assert.equal(afterFirst.processingJob,null);
  assert.equal(published,0);
  clock=secondSlot+1000;
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'retry_generation');
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'idle');
  clock+=120_000;
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'retry_generation');
  assert.equal(published,0);
  clock+=180_000;
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,rejectLast?'retry_generation':'published');
  if(rejectLast){clock+=300_000;assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'failed');}
  assert.deepEqual(created,['carousel','carousel',...Array(rejectLast?4:3).fill('short_video')]);
  assert.deepEqual(reelsRecovery,rejectLast?[undefined,'photo','simplified','simplified']:[undefined,'photo','simplified']);
  assert.equal(new Set(reelDraftKeys).size,1);
  assert.equal(published,rejectLast?0:1);
  assert.equal(f.database.values.get(f.ruleRef.path)!.enabled,false);
 }
});

test('an interrupted generation can resume the same slot, while the old invocation cannot save its draft',async()=>{
 const {processAutonomyRule}=await import('./autonomy-worker');
 const f=await autonomyFixture();
 let clock=Date.now(),release!:()=>void,calls=0,publishes=0;
 const gate=new Promise<void>(resolve=>release=resolve);
 const keys:string[]=[];
 const deps={
  database:f.database as never,now:()=>clock,
  create:(async(_request:Request,options:Parameters<typeof createSocialContent>[1])=>{
   const draft=options!.scheduledDraft!;
   keys.push(draft.id);
   if(++calls===1)await gate;
   const result={id:draft.id,title:'Arus kas'};
   await draft.persist(f.ref.collection('social_drafts').doc(draft.id) as never,{draft:result});
   return{draft:result};
  })as never,
  publish:(async()=>{publishes++;return{draft:{status:'published'},receipts:[]};})as never,
 };
 const abandoned=processAutonomyRule(f.ruleRef as never,deps);
 while(!calls)await new Promise(resolve=>setImmediate(resolve));
 clock+=6*60_000+1;
 await processAutonomyRule(f.ruleRef as never,deps);
 const rule=()=>f.database.values.get(f.ruleRef.path)!;
 const jobId=rule().pendingJob;
 assert.equal(f.database.values.get(`${f.ruleRef.path}/jobs/${jobId}`)?.state,'retry_generation');
 clock+=120_000;
 assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'published');
 release();
 await abandoned;
 assert.equal(keys.length,2);
 assert.equal(keys[0],keys[1]);
 assert.equal(publishes,1);
 assert.equal(rule().sequence,1);
 assert.equal(rule().enabled,true);
 assert.equal([...f.database.values.keys()].filter(key=>key.includes('/social_drafts/')).length,1);
 assert.equal(f.database.values.get(`${f.ruleRef.path}/jobs/${jobId}`)?.state,'published');
});

test('a draft saved before the worker was interrupted is sent after recovery without generating again',async()=>{
 const {processAutonomyRule}=await import('./autonomy-worker');
 const f=await autonomyFixture();
 let clock=Date.now(),release!:()=>void,publishes=0,saved=false;
 const gate=new Promise<void>(resolve=>release=resolve);
 const deps={
  database:f.database as never,now:()=>clock,
  create:(async(_request:Request,options:Parameters<typeof createSocialContent>[1])=>{
   const scheduled=options!.scheduledDraft!;
   const draft={id:scheduled.id,title:'Arus kas'};
   await scheduled.persist(f.ref.collection('social_drafts').doc(scheduled.id) as never,{draft});
   saved=true;await gate;return{draft};
  })as never,
  publish:(async(request:Request)=>{const {draftId}=await request.json();assert.ok(f.database.values.has(`${f.ref.path}/social_drafts/${draftId}`));publishes++;return{draft:{status:'published'},receipts:[]};})as never,
 };
 const interrupted=processAutonomyRule(f.ruleRef as never,deps);
 while(!saved)await new Promise(resolve=>setImmediate(resolve));
 clock+=6*60_000+1;
 await processAutonomyRule(f.ruleRef as never,deps);
 assert.equal((await processAutonomyRule(f.ruleRef as never,{...deps,create:(async()=>assert.fail('must reuse draft'))as never})).state,'published');
 release();await interrupted;
 assert.equal(publishes,1);
});

test('a definite transient send is retried on the same draft; pause cancels the persisted retry',async()=>{
 const {processAutonomyRule}=await import('./autonomy-worker');
 for(const pause of [false,true]){
  const f=await autonomyFixture();
  let clock=Date.now(),creates=0;
  const sends:boolean[]=[];
  const deps={
   database:f.database as never,now:()=>clock,
   create:(async()=>{creates++;return{draft:{id:'draft_same',title:'Arus kas'}};})as never,
   publish:(async(request:Request,options:NonNullable<Parameters<typeof publishSocialContent>[1]>)=>{
    assert.equal((await request.json()).draftId,'draft_same');
    assert.equal(options.stopOnUnknown,true);
    sends.push(options.retryTransientFailures===true);
    return sends.length===1?{draft:{status:'publish_failed'},receipts:[{status:'failed',retryable:true}]}:{draft:{status:'published'},receipts:[{status:'published'}]};
   })as never,
  };
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'retry_publication');
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'idle');
  if(pause)await f.updateAutonomy(f.request('pause',2),f.autoDeps);
  clock+=120_000;
  assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,pause?'inactive':'published');
  assert.deepEqual(sends,pause?[false]:[false,true]);
  assert.equal(creates,1);
 }
});

test('an interrupted send is marked published only if the same draft already has confirmed receipts',async()=>{
 const {processAutonomyRule}=await import('./autonomy-worker');
 for(const confirmed of [true,false]){
  const f=await autonomyFixture();
  const clock=Date.now();
  const job=f.ruleRef.collection('jobs').doc('slot_interrupted');
  Object.assign(f.rule,{processingJob:job.id,processingRun:'interrupted',processingUntil:clock-1,nextSlotMs:clock+60_000});
  f.database.values.set(job.path,{state:'publishing',ruleRevision:2,draftKey:'draft_exact',draftId:'draft_exact'});
  f.database.values.set(`${f.ref.path}/publish_jobs/draft_exact`,confirmed?{state:'published',receipts:[{status:'published',externalPostId:'remote-exact'}]}:{state:'processing',receipts:[]});
  await processAutonomyRule(f.ruleRef as never,{database:f.database as never,now:()=>clock,create:(async()=>assert.fail('must not generate'))as never,publish:(async()=>assert.fail('must not resend'))as never});
  assert.equal(f.database.values.get(job.path)?.state,confirmed?'published':'needs_attention');
  assert.equal(f.database.values.get(f.ruleRef.path)?.enabled,confirmed);
 }
});

test('the last dated slot completes its queued publication and then turns the rule off',async()=>{
 const {processAutonomyRule}=await import('./autonomy-worker');
 const f=await autonomyFixture();
 const finalSlot=Date.parse('2026-11-12T06:00:00Z');
 let clock=finalSlot+1000, creates=0, publishes=0;
 Object.assign(f.rule,{config:{...f.config,days:['Kam'],timesWib:['12:00','13:00'],endsOnWib:'2026-11-12'},nextSlotMs:finalSlot,nextDueMs:finalSlot});
 const deps={database:f.database as never,now:()=>clock,create:(async()=>{creates++;return{draft:{id:'draft_auto',title:'Arus kas'}};})as never,publish:(async()=>{publishes++;return{hasMore:publishes===1,draft:{status:publishes===1?'publish_queued':'published'},receipts:[]};})as never};
 assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'queued');
 assert.equal(f.database.values.get(f.ruleRef.path)!.enabled,true);
 clock+=61000;
 assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'published');
 const rule=f.database.values.get(f.ruleRef.path)!;
 assert.equal(rule.enabled,false);
 assert.equal(rule.nextSlotMs,null);
 assert.equal(rule.nextDueMs,null);
 assert.equal((await processAutonomyRule(f.ruleRef as never,deps)).state,'inactive');
 assert.equal(creates,1);
 assert.equal(publishes,2);
});

test('durable dispatch fence serializes pause and account/profile mutations until leased HTTP send drains',async()=>{
 const {createAutonomyDispatch,dispatchGuard}=await import('./autonomy-dispatch');const{publicRule}=await import('./autonomy-api');const{updateBusiness}=await import('./business-contexts');const{disconnectSocialAccount}=await import('./social-connections');const f=await autonomyFixture();
 let sends=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const sender=createAutonomyDispatch(f.ref as never,async tx=>{const r=(await tx.get(f.ruleRef as unknown as FirebaseFirestore.DocumentReference)).data();if(!r?.enabled)throw new ApiError(409,'Aturan dijeda');},(async()=>{sends++;await gate;return new Response('{"id":"provider-post"}');})as typeof fetch);
 f.rule.processingJob='test_dispatch';f.rule.processingUntil=Date.now()+60000;
 const first=sender('https://provider.test/publish',{method:'POST'});while(!sends)await new Promise(resolve=>setImmediate(resolve));const second=sender('https://provider.test/publish',{method:'POST'});
 await assert.rejects(disconnectSocialAccount(new Request('http://localhost'),f.ref.id,'instagram_200',{authorize:f.authorize as never,database:f.database as never}),/Pengiriman otomatis/);
 await assert.rejects(updateBusiness(new Request('http://localhost',{method:'PATCH',body:JSON.stringify({workspaceId:f.ref.id,businessId:'primary',expectedRevision:1,connectionIds:[]})}),{authorize:f.authorize as never}),/Pengiriman otomatis/);
 const paused=await f.updateAutonomy(f.request('pause',2),f.autoDeps);assert.equal(paused.rule?.enabled,false);assert.equal(paused.rule?.pausePending,true);assert.equal(sends,1);
 await assert.rejects(f.updateAutonomy(f.request('activate',3),f.autoDeps),/Pengiriman otomatis/);release();await first;await assert.rejects(second,/dijeda/);assert.equal(sends,1);assert.equal(f.database.values.has(dispatchGuard(f.ref as never).path),false);
 f.database.values.get(f.ruleRef.path)!.processingJob=null;assert.equal(publicRule(f.database.values.get(f.ruleRef.path))?.pausePending,false);
 await disconnectSocialAccount(new Request('http://localhost'),f.ref.id,'instagram_200',{authorize:f.authorize as never,database:f.database as never});
});

test('ambiguous provider timeout, truncated body and 5xx retain fence and block mutation/reactivation',async()=>{
 const {createAutonomyDispatch,dispatchGuard}=await import('./autonomy-dispatch');for(const mode of['timeout','truncated','server']as const){const f=await autonomyFixture();const sender=createAutonomyDispatch(f.ref as never,async()=>{},(async()=>{if(mode==='timeout')throw Error('connection lost after request');return new Response(mode==='truncated'?'{':'{"error":{"code":2}}',{status:mode==='server'?500:200});})as typeof fetch);
 if(mode==='server')await sender('https://provider.test/publish',{method:'POST'});else await assert.rejects(sender('https://provider.test/publish',{method:'POST'}));
 assert.ok(f.database.values.get(dispatchGuard(f.ref as never).path)?.leaseId);await assert.rejects(f.updateAutonomy(f.request('activate',2),f.autoDeps),/Pengiriman otomatis/);
 let deleted=0;const storage={file:()=>({save:async()=>{},delete:async()=>{deleted++;}})};await assert.rejects(persistWorkspacePhoto(f.ref as never,f.ref.id,'customer-a',Buffer.from('new image'),'New photo',storage as never),/Pengiriman otomatis/);assert.equal(deleted,1);assert.equal([...f.database.values.keys()].some(key=>key.includes('/server_assets/')),false);
 }});

test('Facebook Reels releases preparation fences and checks the exact video after a lost finish response',async()=>{
 const {createAutonomyDispatch,dispatchGuard}=await import('./autonomy-dispatch');
 const {publishMetaReel}=await import('./meta-reels');
 for(const confirmed of [true,false]){
  const f=fixture();
  const guard=dispatchGuard(f.ref as never).path;
  const phases:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
   const url=new URL(String(input));
   const phase=init?.body instanceof URLSearchParams?init.body.get('upload_phase'):null;
   if(phase==='start'){
    phases.push('start');
    return Response.json({video_id:'500',upload_url:'https://rupload.facebook.com/video-upload/v26.0/500'});
   }
   if(url.hostname==='rupload.facebook.com'){phases.push('upload');return Response.json({success:true});}
   if(phase==='finish'){phases.push('finish');throw new Error('finish response lost');}
   assert.match(url.pathname,/\/500$/);
   assert.ok(f.database.values.get(guard)?.leaseId);
   if(!phases.includes('read'))phases.push('read');
   return Response.json({status:confirmed?{video_status:'ready',publishing_phase:{publish_status:'published'}}:{video_status:'ready',publishing_phase:{status:'complete',publish_status:'failed'}}});
  };
  const run=publishMetaReel({channel:'facebook',accountId:'100',token:'fixture',caption:'Uji',videoUrl:'https://example.test/reel.mp4',videoBytes:Buffer.from('test')},{fetcher:createAutonomyDispatch(f.ref as never,async()=>{},fetcher),sleep:async()=>{}});
  if(confirmed)assert.equal((await run).externalPostId,'500');
  else await assert.rejects(run,(error:MetaRequestError)=>error.uncertain);
  assert.deepEqual(phases,['start','upload','finish','read']);
  assert.equal(f.database.values.has(guard),!confirmed);
 }
});

test('only preparation can safely drop its fence after a provider timeout',async()=>{
 const {createAutonomyDispatch,dispatchGuard}=await import('./autonomy-dispatch');
 const f=fixture();
 const guard=dispatchGuard(f.ref as never).path;
 const sender=createAutonomyDispatch(f.ref as never,async()=>{},async()=>{throw new Error('lost');});
 await assert.rejects(sender('https://graph.instagram.com/v26.0/100/media',{method:'POST'}));
 assert.equal(f.database.values.has(guard),false);
 await assert.rejects(sender('https://graph.instagram.com/v26.0/100/media_publish',{method:'POST'}));
 assert.equal(f.database.values.has(guard),true);
});

test('photo metadata commit rechecks a dispatch that starts while private bytes upload',async()=>{const {dispatchGuard}=await import('./autonomy-dispatch');const f=fixture();let deleted=0;const storage={file:()=>({save:async()=>{f.database.values.set(dispatchGuard(f.ref as never).path,{leaseId:'started-during-upload'});},delete:async()=>{deleted++;}})};await assert.rejects(persistWorkspacePhoto(f.ref as never,f.ref.id,'customer-a',Buffer.from('photo'),'Race photo',storage as never),/Pengiriman otomatis/);assert.equal(deleted,1);assert.equal([...f.database.values.keys()].some(key=>key.includes('/server_assets/')),false);});

test('an ambiguous stale dispatch lock is not silently expired and never permits a new send',async()=>{const{createAutonomyDispatch,dispatchGuard}=await import('./autonomy-dispatch');const f=fixture();f.database.values.set(dispatchGuard(f.ref as never).path,{leaseId:'crashed',startedAt:1});let sends=0;const sender=createAutonomyDispatch(f.ref as never,async()=>{},(async()=>{sends++;return new Response('{}');})as typeof fetch);await assert.rejects(sender('https://provider.test/publish',{method:'POST'}),/Pengiriman otomatis/);assert.equal(sends,0);assert.equal(f.database.values.get(dispatchGuard(f.ref as never).path)?.leaseId,'crashed');});

test('autonomy stale slot is skipped; expired/crashed generation never dispatches or regenerates',async()=>{const{processAutonomyRule}=await import('./autonomy-worker');for(const state of['old','expired','crash']as const){const f=await autonomyFixture();let creates=0,publishes=0;if(state==='old')f.rule.nextSlotMs=Date.now()-31*60000;if(state==='expired'){f.rule.processingJob='slot_previous';f.rule.processingUntil=Date.now()-1;f.database.values.set(`${f.ruleRef.path}/jobs/slot_previous`,{state:'generating',scheduledAt:Date.now()-20*60000});}const deps={database:f.database as never,create:(async()=>{creates++;throw new ApiError(503,'Hasil pembuatan belum pasti.');})as never,publish:(async()=>{publishes++;throw Error('must not publish');})as never};await processAutonomyRule(f.ruleRef as never,deps);await processAutonomyRule(f.ruleRef as never,deps);assert.equal(creates,state==='crash'?1:0);assert.equal(publishes,0);if(state!=='old')assert.equal(f.database.values.get(f.ruleRef.path)!.enabled,false);}});

const photoId = '123e4567-e89b-42d3-a456-426614174000';
async function seedPhoto(f: ReturnType<typeof fixture>) {
 const storagePath=`workspaces/${f.ref.id}/vault/${photoId}.jpg`;
 const asset={id:photoId,workspaceId:f.ref.id,title:'Foto produk',description:'',drawer:'real_asset',mediaType:'photo',previewUrl:'https://example.test/original.jpg',aspectRatio:'4:5',tags:[],uploadedFrom:'web',createdAt:new Date().toISOString(),usedInPostsCount:0};
 f.database.values.set(`${f.ref.path}/server_assets/${photoId}`,{asset,storagePath});
 f.blobs.set(storagePath,await sharp({create:{width:800,height:600,channels:3,background:'#e0e0e0'}}).jpeg().toBuffer());
 return {asset,storagePath};
}
function photoRequest(f: ReturnType<typeof fixture>, action: 'trash'|'restore', assetId=photoId) { return new Request('http://localhost/api',{method:'PATCH',body:JSON.stringify({workspaceId:f.ref.id,assetId,action})}); }
test('admin development policy permits concurrent attempts beyond six and keeps exact usage; disabling restores normal cap',async()=>{
 const f=fixture();const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 f.database.values.set(`${f.ref.path}/generation_usage/${day}`,{count:6});
 f.database.values.set(`platform_configs/generation_${f.ref.id}`,{workspaceId:f.ref.id,mode:'development',enabled:true});
 const tiny=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();
 const results=await Promise.all(Array.from({length:4},(_,index)=>f.create({format:index%2?'carousel':'single_post',renderImage:async()=>tiny})));
 assert.equal(f.generationCount(),10);assert.equal(f.generateCalls(),4);for(const result of results){assert.equal(result.generationQuota.mode,'development');assert.equal(result.generationQuota.dailyLimit,null);}
 assert.deepEqual(results.map(x=>x.generationQuota.used).sort((a,b)=>a-b),[7,8,9,10]);assert.equal(f.count(),0);
 f.database.values.set(`platform_configs/generation_${f.ref.id}`,{workspaceId:f.ref.id,mode:'development',enabled:false});
 await assert.rejects(f.create(),error=>error instanceof ApiError&&error.status===429);assert.equal(f.generationCount(),10);assert.equal(f.generateCalls(),4);
});

test('absent, malformed, other-workspace and client-spoofed flags cannot bypass standard generation cap',async()=>{
 for(const policy of [undefined,{}, {workspaceId:'other-tenant',mode:'development',enabled:true},{workspaceId:'workspace-a',mode:'production',enabled:true},{workspaceId:'workspace-a',mode:'development',enabled:'true'}]){
  const f=fixture();const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  f.database.values.set(`${f.ref.path}/generation_usage/${day}`,{count:6});if(policy)f.database.values.set(`platform_configs/generation_${f.ref.id}`,policy);
  const record=f.database.values.get(f.ref.path)!;record.developmentUnlimited=true;const snapshot=JSON.parse(record.snapshotJson);snapshot.generationPolicy={mode:'development',enabled:true};record.snapshotJson=JSON.stringify(snapshot);
  const request=new Request('http://localhost/api',{method:'POST',body:JSON.stringify({workspaceId:f.ref.id,expectedProfileFingerprint:await profileFingerprint(snapshot.brand),topic:'Uji',format:'single_post',developmentUnlimited:true,generationPolicy:{mode:'development',enabled:true}})});
  await assert.rejects(createSocialContent(request,{authorize:f.authorize as never,generate:async()=>{throw Error('Provider must not be called');}}),error=>error instanceof ApiError&&error.status===429);
  assert.equal(f.generationCount(),6);assert.equal(f.generateCalls(),0);
 }
});

test('generation uses saved profile and server default topic; stale fingerprint and huge context spend no quota',async()=>{
 const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,businessName:'Profil Server',city:'Seluruh Indonesia (online)'};record.snapshotJson=JSON.stringify(snapshot);
 const request=async(extra:object)=>new Request('http://localhost/api',{method:'POST',body:JSON.stringify({workspaceId:f.ref.id,expectedProfileFingerprint:await profileFingerprint(JSON.parse(record.snapshotJson).brand),topic:'',format:'single_post',...extra})});
 await assert.rejects(createSocialContent(await request({expectedProfileFingerprint:'0'.repeat(64)}),{authorize:f.authorize as never}),error=>error instanceof ApiError&&error.code==='profile_conflict');assert.equal(f.generationCount(),0);
 await assert.rejects(createSocialContent(await request({expectedProfileFingerprint:undefined}),{authorize:f.authorize as never}),error=>error instanceof ApiError&&error.code==='profile_conflict');assert.equal(f.generationCount(),0);
 let input:any;const result=await createSocialContent(await request({}),{authorize:f.authorize as never,storage:f.dependencies.storage,generate:async value=>{input=value;return{draft:shortVisualDraft(value),engineMode:'deterministic_local'};},renderImage:async()=>sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer()});assert.equal(input.brand.businessName,'Profil Server');assert.equal(input.customTopic,'Perkenalkan Profil Server, melayani Seluruh Indonesia (online)');assert.equal(result.draft.profileContext?.fingerprint.length,64);assert.equal(f.generationCount(),1);
 snapshot.brand.offerings=Array.from({length:10},(_,i)=>({id:`p${i}`,title:`Produk ${i}`,highlight:'x'.repeat(3000),priceLabel:'',category:'service'}));record.snapshotJson=JSON.stringify(snapshot);
 await assert.rejects(createSocialContent(await request({}),{authorize:f.authorize as never}),error=>error instanceof ApiError&&error.code==='profile_context_invalid');assert.equal(f.generationCount(),1);
});

test('every single and carousel image receives all product details, full description, website, area and tone',async()=>{
 for(const format of ['single_post','carousel'] as const){const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,businessDescription:'D'.repeat(2000),websiteUrl:'https://business.example.test',brandTone:'Profesional',city:'Indonesia',offerings:Array.from({length:7},(_,i)=>({id:`p${i}`,title:`Produk ${i}`,highlight:`DETAIL_${i}_`+'x'.repeat(300),priceLabel:'',category:'service'}))};record.snapshotJson=JSON.stringify(snapshot);let calls=0;
 await f.create({format,renderImage:async input=>{calls++;assert.equal(input.businessContext!.description,snapshot.brand.businessDescription);assert.deepEqual(input.businessContext!.offerings,snapshot.brand.offerings);assert.equal(input.businessContext!.websiteUrl,snapshot.brand.websiteUrl);assert.equal(input.businessContext!.brandTone,'Profesional');return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});assert.equal(calls,format==='carousel'?5:1);
 }
});

test('publisher blocks old forged-passed hashtags and newly prohibited words before quota or dispatch',async()=>{
 for(const source of ['current','generation'] as const){const f=fixture();const {draft}=await f.create();const stored=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;stored.draft.hashtags=['#Termurah'];stored.draft.qualityReview.passed=true;
 if(source==='current'){const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand.forbiddenWords=['termurah'];record.snapshotJson=JSON.stringify(snapshot);}else stored.forbiddenWordsAtGeneration=['termurah'];
 let sent=0;await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async()=>{sent++;return{externalPostId:'should-not-send'};}}),error=>error instanceof ApiError&&error.code==='content_policy_violation');assert.equal(sent,0);assert.equal(f.count(),0);
 }
});

test('each no-reference carousel image receives its own exact slide copy and distinct semantic scene',async()=>{
 const f=fixture();const scenes=['Pemilik usaha merencanakan operasional','Kasir mencatat transaksi penjualan','Petugas gudang menghitung persediaan','Tim keuangan meninjau catatan','Tim bisnis berkoordinasi di meja rapat'];let rendered=0;
 await f.create({format:'carousel',generate:async input=>{const draft=shortVisualDraft(input);draft.slides=scenes.map((visualDirection,index)=>({slideNumber:index+1,headline:`Pesan ${index+1}`,body:`Penjelasan ${index+1}`,visualDirection,badgeText:`${index+1}/5`}));return{draft,engineMode:'deterministic_local'};},renderImage:async params=>{const index=rendered++;assert.equal(params.title,`Pesan ${index+1}`);assert.equal(params.hook,`Penjelasan ${index+1}`);assert.equal(params.visualDirection,scenes[index]);return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});assert.equal(rendered,5);assert.equal(f.generationCount(),1);
});

test('no-reference single and carousel forward real business context; every carousel scene direction reaches renderer',async()=>{
 for(const format of ['single_post','carousel'] as const){
  const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,businessDescription:'Berez ERP untuk stok dan penjualan',targetAudience:'Pemilik usaha',offerings:[{id:'erp',title:'Sistem pengelolaan usaha',highlight:'Catatan stok',priceLabel:'',category:'service'}]};record.snapshotJson=JSON.stringify(snapshot);
  let seen=0;await f.create({format,topic:'Kenalan dengan Berez ERP',renderImage:async params=>{seen++;assert.match(params.businessContext!.description,/Berez ERP untuk stok dan penjualan/);assert.ok(params.businessContext!.offerings?.some(item=>item.highlight==='Catatan stok'));assert.equal(params.businessContext!.audience,'Pemilik usaha');assert.equal(params.businessContext!.topic,'Kenalan dengan Berez ERP');if(format==='carousel')assert.equal(params.visualDirection,'Visual direction');return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});
  assert.equal(seen,format==='carousel'?5:1);assert.equal(f.generationCount(),1);
 }
});

test('saved DNA reaches single and all carousel images with or without references; invalid palette fails before quota',async()=>{
 for(const format of ['single_post','carousel'] as const)for(const references of [false,true]){
  const f=fixture();if(references)await seedPhoto(f);
  const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,useBrandPalette:true,primaryColorHex:'#167D8D',accentColorHex:'#FCAB20',additionalColorHexes:['#263D48']};record.snapshotJson=JSON.stringify(snapshot);
  let seen=0;await f.create({format,...(references?{referenceAssetIds:[photoId]}:{}),renderImage:async params=>{seen++;assert.deepEqual(params.brandPalette,['#167D8D','#FCAB20','#263D48']);return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});
  assert.equal(seen,format==='carousel'?5:1);assert.equal(f.generationCount(),1);
 }
 const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,useBrandPalette:true,primaryColorHex:'invalid'};record.snapshotJson=JSON.stringify(snapshot);
 await assert.rejects(f.create(),error=>error instanceof ApiError&&error.status===409);assert.equal(f.generationCount(),0);assert.equal(f.generateCalls(),0);
});

test('vault uploads create private objects, expose only authenticated preview paths, and clean failed metadata writes',async()=>{
 const f=fixture();const bytes=Buffer.from('private fixture');const writes:any[]=[];const deleted:string[]=[];
 const storage={name:'private-fixture',file:(path:string)=>({save:async(data:Buffer,options:any)=>{writes.push({path,data,options});},delete:async()=>{deleted.push(path);}})};
 const asset=await persistWorkspacePhoto(f.ref as never,f.ref.id,'customer-a',bytes,'Private photo',storage as never);
 assert.match(asset.previewUrl,/^\/api\/veloxa\/media\/preview\//);assert.equal(asset.previewUrl.includes('alt=media'),false);assert.equal(writes[0].options.metadata.metadata,undefined);assert.match(writes[0].options.metadata.cacheControl,/private/);assert.equal(deleted.length,0);
 const failingRef={collection:()=>({doc:()=>({create:async()=>{throw Object.assign(new Error('PRIVATE_DATABASE_ERROR'),{code:7});},get:async()=>({exists:false,data:()=>undefined})})})};
 Object.assign(failingRef,{firestore:{runTransaction:async(fn:any)=>{let value:any;const result=await fn({get:async()=>({data:()=>undefined}),create:(_ref:any,item:any)=>{value=item;}});await failingRef.collection().doc().create();return result;}}});
 await assert.rejects(persistWorkspacePhoto(failingRef as never,f.ref.id,'customer-a',bytes,'Failed photo',storage as never),error=>error instanceof ApiError&&error.status===503&&!error.message.includes('PRIVATE_DATABASE_ERROR'));
 assert.equal(deleted.length,1);assert.equal(deleted[0],writes[1].path);assert.notEqual(deleted[0],writes[0].path);
});
test('ambiguous photo metadata failures preserve bytes and recover confirmed commits',async()=>{
 const f=fixture();let deleted=0;const storage={file:()=>({save:async()=>{},delete:async()=>{deleted++;}})};
 let record:any;
 const committedRef={collection:()=>({doc:()=>({create:async(value:any)=>{record=value;throw Object.assign(new Error('late response'),{code:4});},get:async()=>({exists:true,data:()=>record})})})};
 Object.assign(committedRef,{firestore:{runTransaction:async(fn:any)=>{let value:any;const result=await fn({get:async()=>({data:()=>undefined}),create:(_ref:any,item:any)=>{value=item;}});await committedRef.collection().doc().create(value);return result;}}});
 const result=await persistWorkspacePhoto(committedRef as never,f.ref.id,'customer-a',Buffer.from('fixture'),'Recovered',storage as never);assert.equal(result.id,record.asset.id);assert.equal(deleted,0);
 for(const unreadable of [false,true]){
  const uncertainRef={collection:()=>({doc:()=>({create:async()=>{throw Object.assign(new Error('timeout'),{code:4});},get:async()=>{if(unreadable)throw new Error('network');return{exists:false,data:()=>undefined};}})})};
  Object.assign(uncertainRef,{firestore:{runTransaction:async(fn:any)=>{let value:any;const result=await fn({get:async()=>({data:()=>undefined}),create:(_ref:any,item:any)=>{value=item;}});await uncertainRef.collection().doc().create();return result;}}});
  await assert.rejects(persistWorkspacePhoto(uncertainRef as never,f.ref.id,'customer-a',Buffer.from('fixture'),'Uncertain',storage as never),error=>error instanceof ApiError&&error.code==='photo_save_uncertain');
  assert.equal(deleted,0);
 }
});

test('protected photo preview enforces workspace authorization and never returns download-token links',async()=>{
 const f=fixture();const original=await seedPhoto(f);const response=await previewWorkspacePhoto(f.request('none'),f.ref.id,photoId,f.dependencies);
 assert.equal(response.headers.get('Content-Type'),'image/jpeg');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.blobs.get(original.storagePath));
 const listed=await listWorkspacePhotos(f.request('none'),f.ref.id,true,f.dependencies);assert.match(listed[0].previewUrl,/^\/api\/veloxa\/media\/preview\//);assert.equal(listed[0].previewUrl.includes('example.test'),false);
 await assert.rejects(previewWorkspacePhoto(f.request('none'),'foreign-workspace',photoId,f.dependencies));
 let reads=0;
 const unauthorized=async()=>{throw new ApiError(401,'Unauthenticated');};
 const noReadStorage={file:()=>({download:async()=>{reads++;return[Buffer.alloc(0)];}})};
 await assert.rejects(previewWorkspacePhoto(f.request('none'),f.ref.id,photoId,{authorize:unauthorized,storage:noReadStorage} as never));assert.equal(reads,0);
});
test('gallery returns every authorized record beyond100 including authoritative trash entries',async()=>{
 const f=fixture();const original=await seedPhoto(f);f.database.values.delete(`${f.ref.path}/server_assets/${photoId}`);
 for(let index=0;index<135;index++){const id='123e4567-e89b-42d3-a456-'+String(index).padStart(12,'0');f.database.values.set(`${f.ref.path}/server_assets/${id}`,{asset:{...original.asset,id},storagePath:`workspaces/${f.ref.id}/vault/${id}.jpg`,...(index===134?{trashedAt:Date.now()}:{})});}
 assert.equal((await listWorkspacePhotos(f.request('none'),f.ref.id,true,f.dependencies)).length,135);
 assert.equal((await listWorkspacePhotos(f.request('none'),f.ref.id,false,f.dependencies)).length,134);
});

test('photo trash/restore is recoverable, idempotent, server-authoritative and retains original bytes',async()=>{
 const f=fixture();const original=await seedPhoto(f);const before=f.blobs.get(original.storagePath);
 const moved=await changeWorkspacePhotoState(photoRequest(f,'trash'),f.dependencies);assert.ok(moved.trashedAt);
 const repeated=await changeWorkspacePhotoState(photoRequest(f,'trash'),f.dependencies);assert.equal(repeated.trashedAt,moved.trashedAt);
 assert.equal((await listWorkspacePhotos(f.request('none'),f.ref.id,false,f.dependencies)).length,0);
 const all=await listWorkspacePhotos(f.request('none'),f.ref.id,true,f.dependencies);assert.equal(all.length,1);assert.equal(all[0].trashedAt,moved.trashedAt);
 // A stale snapshot/nested field cannot untrash a server asset.
 const key=`${f.ref.path}/server_assets/${photoId}`;const record=f.database.values.get(key)!;record.asset.trashedAt=undefined;
 const workspace=(await f.ref.get()).data()!;const snapshot=JSON.parse(workspace.snapshotJson);snapshot.vaultAssets=[original.asset];f.database.write(f.ref,{snapshotJson:JSON.stringify(snapshot)});
 await assert.rejects(f.create({sourceAssetId:photoId}),/pulihkan dari Sampah/);assert.equal(f.generationCount(),0);assert.equal(f.generateCalls(),0);
 const restored=await changeWorkspacePhotoState(photoRequest(f,'restore'),f.dependencies);assert.equal(restored.trashedAt,undefined);
 assert.equal((await listWorkspacePhotos(f.request('none'),f.ref.id,false,f.dependencies)).length,1);assert.deepEqual(f.blobs.get(original.storagePath),before);
 const {draft}=await f.create({sourceAssetId:photoId});assert.deepEqual(draft.usedRealAssetIds,[photoId]);assert.equal(f.generationCount(),1);
});
test('trashing a source photo leaves saved draft renders and publishing intact',async()=>{
 const f=fixture();await seedPhoto(f);const{draft}=await f.create({sourceAssetId:photoId});const bytesBefore=[...f.blobs.keys()];
 await changeWorkspacePhotoState(photoRequest(f,'trash'),f.dependencies);
 assert.deepEqual([...f.blobs.keys()],bytesBefore);
 const sent:string[]=[];const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async input=>{sent.push(input.channel);return{externalPostId:`post-${input.channel}`};}});
 assert.equal(result.draft.status,'published');assert.equal(sent.length,2);
});
test('photo operations reject foreign records/paths, missing ids and revoked workspace access without writes',async()=>{
 for(const mode of ['asset-workspace','storage-workspace','traversal','missing','revoked']){
  const f=fixture();await seedPhoto(f);const key=`${f.ref.path}/server_assets/${photoId}`;const record=f.database.values.get(key)!;
  if(mode==='asset-workspace')record.asset.workspaceId='foreign';if(mode==='storage-workspace')record.storagePath=`workspaces/foreign/vault/${photoId}.jpg`;if(mode==='traversal')record.storagePath=`workspaces/${f.ref.id}/vault/../renders/${photoId}.jpg`;if(mode==='missing')f.database.values.delete(key);
  const authorize=async(request:Request,id:unknown)=>{const result=await f.authorize(request,id);if(mode==='revoked')f.database.values.get(f.ref.path)!.ownerUid='different-user';return result;};
  await assert.rejects(changeWorkspacePhotoState(photoRequest(f,'trash'),{authorize:authorize as never}));assert.equal(record.trashedAt,undefined);assert.equal(f.generationCount(),0);
 }
 const f=fixture();await seedPhoto(f);await assert.rejects(changeWorkspacePhotoState(photoRequest(f,'trash','../foreign'),f.dependencies));
});

async function seedReferences(f: ReturnType<typeof fixture>,count=3) {
 const original=await seedPhoto(f);const ids=Array.from({length:count},(_,i)=>photoId.slice(0,-1)+i);
 for(const [index,id]of ids.entries()){
  const storagePath=`workspaces/${f.ref.id}/vault/${id}.jpg`;
  f.database.values.set(`${f.ref.path}/server_assets/${id}`,{asset:{...original.asset,id,title:`Reference ${index+1}`},storagePath});f.blobs.set(storagePath,f.blobs.get(original.storagePath)!);
 }
 return ids;
}
test('all chosen reference bytes and direction reach single/carousel visuals and saved source ids',async()=>{
 for(const format of ['single_post','carousel'] as const)for(const count of [3,4,5,6]){
  const f=fixture();const ids=await seedReferences(f,count);const seen:any[]=[];let brief:any;
  const instruction='Orang mempresentasikan ERP di ruang meeting.';
  const {draft}=await f.create({format,referenceAssetIds:ids,referenceInstruction:instruction,generate:async input=>{brief=input.referenceBrief;const draft=shortVisualDraft(input);if(format==='carousel')draft.slides=Array.from({length:5},(_,i)=>({slideNumber:i+1,headline:'Slide '+i,body:'Penjelasan',visualDirection:'Ruang rapat',badgeText:''}));return{draft,engineMode:'deterministic_local'};},renderImage:async input=>{seen.push(input);return sharp({create:{width:1080,height:1350,channels:3,background:'#fff'}}).jpeg().toBuffer();}});
  assert.equal(seen.length,format==='carousel'?5:1);for(const input of seen){assert.equal(input.referenceImages.length,count);assert.equal(input.referenceInstruction,instruction);assert.deepEqual(input.referenceImages,ids.map(id=>f.blobs.get(`workspaces/${f.ref.id}/vault/${id}.jpg`)));}
  assert.deepEqual(brief,{titles:ids.map((_,index)=>`Reference ${index+1}`),instruction});assert.deepEqual(draft.usedRealAssetIds,ids);assert.equal(draft.referenceInstruction,instruction);assert.equal(f.generationCount(),1);
 }
});
test('carousel routes actual screenshot bytes per slide, keeps shared photos and preserves reference numbering', async () => {
  const f = fixture();
  const ids = await seedReferences(f, 4);
  for (const index of [0, 2, 3]) {
    const record = f.database.values.get(`${f.ref.path}/server_assets/${ids[index]}`)!;
    record.asset.category = 'screenshot';
  }
  const scene = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#82A0B2' } }).jpeg().toBuffer();
  const seen: Parameters<typeof import('./content-image').generateSocialPostImage>[0][] = [];
  const {draft} = await f.create({
    format: 'carousel',
    referenceAssetIds: ids,
    referenceInstruction: 'Slide 1: Pakai Ref 3. Slide 2: Pakai Ref 1. Slide 3: Fokus Ref 2.',
    referenceRoles: {[ids[0]]:'visual', [ids[1]]:'visual', [ids[2]]:'visual', [ids[3]]:'screenshot'},
    renderImage: async input => {
      seen.push(input);
      return scene;
    },
  });
  assert.equal(seen.length, 5);
  for (const [index, attachedIndexes] of [[0,[1,2]], [1,[0,1]], [2,[1]]] as const) {
    assert.deepEqual(seen[index].referenceImages, attachedIndexes.map(i=>f.blobs.get(`workspaces/${f.ref.id}/vault/${ids[i]}.jpg`)));
    assert.deepEqual(seen[index].sceneReferenceLabels, attachedIndexes.map(i=>`Ref ${i+1}: ${i===1?'':'Screenshot aplikasi: '}Reference ${i+1}`));
    assert.equal(seen[index].hasOriginalScreenshot, true);
  }
  assert.deepEqual(seen[0].screenshotReferenceLabels, ['Ref 3: Screenshot aplikasi: Reference 3']);
  assert.deepEqual(seen[1].screenshotReferenceLabels, ['Ref 1: Screenshot aplikasi: Reference 1']);
  assert.equal(seen[2].screenshotReferenceLabels, undefined);
  assert.equal(seen[0].slideReferenceDirection,'Pakai Ref 3.');
  assert.deepEqual(draft.usedRealAssetIds, ids);
});

test('reviewed carousel plan drives final copy and actual image attachments for each slide', async () => {
 const f = fixture();
 const ids = await seedReferences(f, 3);
 f.database.values.get(`${f.ref.path}/server_assets/${ids[1]}`)!.asset.category = 'screenshot';
 const referenceRoles = {[ids[0]]:'visual', [ids[1]]:'visual', [ids[2]]:'logo'} as const;
 const carouselPlan = reviewedSlides.map((slide, index) => ({
  ...slide, assetIds: index === 0 ? [ids[1]] : index === 1 ? [ids[0]] : [],
 }));
 const invalidPlan = carouselPlan.map(slide => ({...slide, assetIds: [ids[2]]}));
 await assert.rejects(f.create({format:'carousel', carouselPlan:invalidPlan, referenceAssetIds:ids, referenceRoles}), /slide 1/);
 assert.equal(f.generationCount(), 0);
 const seen: SocialPostImageParams[] = [];
 const topic = 'Fokus yang dipilih pengguna';
 const {draft} = await f.create({
  format: 'carousel', topic, carouselPlan, referenceAssetIds: ids, referenceRoles,
  referenceInstruction: 'Gunakan pencahayaan alami.',
  generate: async input => {
   assert.equal(input.customTopic, topic);
   assert.deepEqual(input.carouselPlan, carouselPlan);
   return {draft:shortVisualDraft(input), engineMode:'deterministic_local'};
  },
  renderImage: async input => {
   seen.push(input);
   return sharp({create:{width:1080,height:1350,channels:3,background:'#fff'}}).jpeg().toBuffer();
  },
 });
 assert.deepEqual(draft.slides?.map(({headline,body,visualDirection})=>({headline,body,visualDirection})), reviewedSlides);
 assert.equal(seen.length, 5);
 for (const [index, input] of seen.entries()) {
  assert.equal(input.sceneOnly, false);
  assert.equal(input.hasOriginalLogo, true);
  assert.equal(input.title, reviewedSlides[index].headline);
  assert.equal(input.hook, reviewedSlides[index].body);
  assert.equal(input.visualDirection, reviewedSlides[index].visualDirection);
  assert.equal(input.referenceInstruction, 'Gunakan pencahayaan alami.');
  const expected = carouselPlan[index].assetIds.map(id=>f.blobs.get(`workspaces/${f.ref.id}/vault/${id}.jpg`));
  assert.deepEqual(input.referenceImages ?? [], expected);
 }
 assert.match(seen[0].slideReferenceDirection ?? '', /Ref 2/);
 assert.equal(seen[2].slideReferenceDirection, undefined);
 assert.equal(f.count(), 0);
});

test('protected originals stay out of AI scene requests and are composited into every post/carousel',async()=>{
 for(const format of ['single_post','carousel'] as const){
  const f=fixture();const ids=await seedReferences(f,3);let calls=0;
  const roles={[ids[0]]:'visual',[ids[1]]:'screenshot',[ids[2]]:'logo'} as const;
  const {draft}=await f.create({format,referenceAssetIds:ids,referenceRoles:roles,renderImage:async(input:any)=>{calls++;assert.equal(input.sceneOnly,format==='single_post');if(format==='carousel')assert.equal(input.hasOriginalLogo,true);assert.deepEqual(input.referenceImages,[f.blobs.get(`workspaces/${f.ref.id}/vault/${ids[0]}.jpg`)]);assert.deepEqual(input.sceneReferenceLabels,['Ref 1: Reference 1']);return sharp({create:{width:1080,height:1350,channels:3,background:'#102030'}}).jpeg().toBuffer();}});
  assert.deepEqual(draft.referenceRoles,roles);assert.equal(calls,format==='carousel'?5:1);assert.deepEqual(draft.usedRealAssetIds,ids);
  const record=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;const paths=record.storagePaths||[record.storagePath];for(const path of paths){const meta=await sharp(f.blobs.get(path)!).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1350);}
 }
});
test('bad or ambiguous roles cannot consume generation quota or invoke providers',async()=>{
 for(const role of ['foreign','invalid','duplicate-logo','duplicate-screen']){const f=fixture();const ids=await seedReferences(f,3);const roles=role==='foreign'?{'123e4567-e89b-42d3-a456-426614174099':'logo'}:role==='invalid'?{[ids[0]]:'not-a-role'}:{[ids[0]]:role==='duplicate-logo'?'logo':'screenshot',[ids[1]]:role==='duplicate-logo'?'logo':'screenshot'};await assert.rejects(f.create({referenceAssetIds:ids,referenceRoles:roles as never}));assert.equal(f.generationCount(),0);assert.equal(f.generateCalls(),0);assert.equal(f.renderCalls(),0);}
});

test('legacy photo renderer records its visible brand and CTA text for generation and publishing policy',async()=>{
 for(const mode of ['generation','publish']){const f=fixture();await seedPhoto(f);const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand.defaultCta='Termurah';snapshot.brand.forbiddenWords=mode==='generation'?['termurah']:[];record.snapshotJson=JSON.stringify(snapshot);
  if(mode==='generation'){await assert.rejects(f.create({sourceAssetId:photoId}),(error:any)=>error.code==='content_policy_violation'&&error.stage==='compositing');assert.equal(f.renderCalls(),0);assert.equal([...f.blobs.keys()].filter(key=>key.includes('/renders/')).length,0);}
  else{const{draft}=await f.create({sourceAssetId:photoId});assert.ok(draft.visualText?.includes('Termurah'));snapshot.brand.forbiddenWords=['termurah'];record.snapshotJson=JSON.stringify(snapshot);let calls=0;await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async()=>{calls++;return{externalPostId:'should-not-send'};}}),(error:any)=>error.code==='content_policy_violation');assert.equal(calls,0);assert.equal(f.count(),0);}
 }
});

test('derived CTA text obeys generation and current publishing policies before image calls or delivery',async()=>{
 for(const mode of ['generation','publish']){const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand.defaultCta='Hubungi tim untuk informasi lebih lengkap mengenai sistem bisnis kami';snapshot.brand.forbiddenWords=mode==='generation'?['pelajari']:[];record.snapshotJson=JSON.stringify(snapshot);
  if(mode==='generation'){await assert.rejects(f.create(),(error:any)=>error.code==='content_policy_violation'&&error.stage==='compositing');assert.equal(f.renderCalls(),0);}
  else{const{draft}=await f.create();assert.ok(draft.visualText?.includes('Pelajari selengkapnya'));snapshot.brand.forbiddenWords=['pelajari'];record.snapshotJson=JSON.stringify(snapshot);let calls=0;await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async()=>{calls++;return{externalPostId:'should-not-send'};}}),(error:any)=>error.code==='content_policy_violation');assert.equal(calls,0);assert.equal(f.count(),0);}
 }
});

test('reference loading uses a bounded Storage range and rejects oversize before buffering full objects',async()=>{
 const f=fixture();const ids=await seedReferences(f,1);const seen:any[]=[];const length=5*1024*1024;
 const storage={file:()=>({download:async(options:{start:number;end:number})=>{seen.push(options);return[Buffer.alloc(Math.min(length,options.end-options.start+1))];}})};
 await assert.rejects(loadContentReferences(f.ref as never,f.ref.id,ids,storage as never),error=>error instanceof ApiError&&error.status===413);
 assert.deepEqual(seen,[{start:0,end:4*1024*1024}]);assert.equal(f.generationCount(),0);assert.equal(f.generateCalls(),0);
});

test('invalid, foreign, trashed, oversized or unavailable references fail before quota and AI',async()=>{
 for(const mode of ['duplicate','too-many','foreign','trashed','corrupt','storage','total-size','url','mixed-legacy']){
  const f=fixture();const ids=await seedReferences(f,mode==='too-many'?7:mode==='total-size'?4:3);const key=`${f.ref.path}/server_assets/${ids[0]}`;const record=f.database.values.get(key)!;
  if(mode==='duplicate')ids.push(ids[0]);if(mode==='foreign')record.storagePath=`workspaces/foreign/vault/${ids[0]}.jpg`;if(mode==='trashed')record.trashedAt=Date.now();if(mode==='corrupt')f.blobs.set(record.storagePath,Buffer.from('not an image'));if(mode==='storage')f.blobs.delete(record.storagePath);if(mode==='url')ids[0]='https://untrusted.example.test/photo.jpg';
  if(mode==='total-size')for(const id of ids){const path=`workspaces/${f.ref.id}/vault/${id}.jpg`;const bytes=f.blobs.get(path)!;f.blobs.set(path,Buffer.concat([bytes,Buffer.alloc(4*1024*1024-bytes.length)]));}
  await assert.rejects(f.create({referenceAssetIds:ids,...(mode==='mixed-legacy'?{sourceAssetId:photoId}:{})}));assert.equal(f.generationCount(),0,mode);assert.equal(f.generateCalls(),0,mode);assert.equal(f.renderCalls(),0,mode);
 }
});

test('content progress reflects completed boundaries and classifies script/image failures safely', async () => {
  for (const format of ['single_post', 'carousel'] as const) {
    const f = fixture(); const stages: string[] = [];
    await f.create({ format, onProgress: event => stages.push(event.stage) });
    assert.deepEqual(stages, ['validation', 'script', 'images', 'compositing', 'saving']);
    assert.equal(f.generationCount(), 1);
  }
  for (const stage of ['script', 'images']) {
    const f = fixture(); const stages: string[] = [];
    const fail = async () => { throw new Error('PRIVATE_PROVIDER_OUTPUT'); };
    await assert.rejects(f.create({ onProgress: event => stages.push(event.stage), ...(stage === 'script' ? { generate: fail } : { renderImage: fail }) }), (error: any) => error.stage === stage && !error.message.includes('PRIVATE_PROVIDER_OUTPUT'));
    assert.equal(stages.at(-1), stage);
    assert.equal(f.generationCount(), 1);
    assert.equal([...f.database.values.keys()].some(key => key.includes('/social_drafts/')), false);
  }
});

test('create real JPEG -> save authoritative draft -> publish both channels -> retry without duplicates', async () => {
  const f = fixture(); const { draft } = await f.create();
  assert.equal(draft.status, 'approved'); assert.equal(f.blobs.size, 1);
  assert.equal(f.renderCalls(), 1);
  assert.deepEqual(draft.targetChannels, ['facebook', 'instagram']);
  const calls: string[] = [];
  const publisher = async (input: any) => { calls.push(input.channel); assert.ok(input.imageBytes.length > 0); return { externalPostId: `remote-${input.channel}`, permalink: `https://example.test/${input.channel}` }; };
  const result = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  assert.equal(result.draft.status, 'published'); assert.equal(f.count(), 1);
  const again = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  assert.equal(again.draft.status, 'published'); assert.deepEqual(calls, ['facebook', 'instagram']); assert.equal(f.count(), 1);
});

test('a legacy Free Trial workspace can use its 20th publication but cannot use a 21st', async () => {
  const f = fixture();
  f.database.write(f.ref, { quotaLimit: 10 });
  f.database.values.set(`${f.ref.path}/publish_usage/${wibMonth()}`, { count: 19 });
  const twentieth = (await f.create()).draft;
  const twentyFirst = (await f.create()).draft;
  let calls = 0;
  const publisher = async ({ channel }: { channel: string }) => {
    calls++;
    return { externalPostId: `remote-${channel}`, permalink: `https://example.test/${channel}` };
  };
  const dependencies = { ...f.dependencies, publisher };
  const result = await publishSocialContent(f.request(twentieth.id), dependencies);
  assert.equal(result.draft.status, 'published');
  assert.equal(result.quotaUsed, 20);
  await assert.rejects(publishSocialContent(f.request(twentyFirst.id), dependencies), { code: 'quota_exhausted' });
  assert.equal(calls, 2);
  assert.equal(f.count(), 20);
});

test('carousel generation renders and stores five ordered slides while consuming one generation quota', async () => {
  const f = fixture();
  const workspace = (await f.ref.get()).data()!;
  const snapshot = JSON.parse(workspace.snapshotJson);
  snapshot.brand.defaultCta = '';
  f.database.write(f.ref, { snapshotJson: JSON.stringify(snapshot) });
  const rendered: SocialPostImageParams[] = [];
  const providerArtwork = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#9DBC7C' } }).jpeg().toBuffer();
  const result = await f.create({
    format: 'carousel',
    renderImage: async params => {
      rendered.push(params);
      return providerArtwork;
    },
  });
  const record = f.database.values.get(`${f.ref.path}/social_drafts/${result.draft.id}`)!;
  assert.equal(rendered.length, 5);
  assert.deepEqual(rendered.map(item => item.title), Array.from({ length: 5 }, (_, index) => `Headline ${index + 1}`));
  assert.deepEqual(rendered.map(item => item.hook), Array.from({ length: 5 }, (_, index) => `Body ${index + 1}`));
  assert.deepEqual(rendered.slice(0, 4).map(item => item.cta), ['', '', '', '']);
  assert.ok(rendered.every(item => item.sceneOnly === false));
  assert.ok(rendered.slice(0,4).every(item => item.website === undefined));
  const expected = await sharp(providerArtwork).jpeg({quality:94}).toBuffer();
  for(const path of record.storagePaths) assert.deepEqual(f.blobs.get(path),expected);
  assert.ok(result.draft.visualText?.every(text => !text.includes('Geser untuk lanjut')));
  assert.equal(rendered[4].cta, 'Simpan');
  assert.equal(result.draft.renderedSlides?.length, 5);
  assert.equal(result.draft.renderedMedia?.url, result.draft.renderedSlides?.[0].url);
  assert.equal(record.storagePaths.length, 5);
  assert.equal(record.storagePath, record.storagePaths[0]);
  assert.deepEqual([...f.blobs.keys()], record.storagePaths);
  assert.equal('storagePaths' in result.draft, false);
  assert.equal('storagePath' in result.draft, false);
  assert.equal(f.generationCount(), 1);
  assert.equal(f.generateCalls(), 1);
});

test('scheduled feed artwork uses the full editorial image and checks every slide before saving', async () => {
  const scene = await sharp({create:{width:1080,height:1350,channels:3,background:'#82A0B2'}}).jpeg().toBuffer();
  for (const format of ['single_post', 'carousel'] as const) {
    const f = fixture();
    const reviewed: string[] = [];
    const finalImages: Buffer[] = [];
    const {draft} = await f.create({
      format, source:'autonomous_agent',
      renderImage:async params=>{
        assert.equal(params.sceneOnly,false);
        assert.equal(params.scheduledEditorial,true);
        return scene;
      },
      verifyArtwork:async (image, params)=>{
        assert.equal(f.blobs.size,0);
        reviewed.push(params.title);
        finalImages.push(image);
      },
    });
    assert.equal(reviewed.length,format==='carousel'?5:1);
    assert.equal(f.blobs.size,reviewed.length);
    assert.deepEqual([...f.blobs.values()], finalImages);
    const record=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;
    const pixel=await sharp(f.blobs.get(record.storagePath)!).extract({left:16,top:1300,width:1,height:1}).raw().toBuffer();
    assert.ok(pixel[0]<155 && pixel[1]<185 && pixel[2]<205);
  }
});

test('an unverified scheduled slide stops the whole batch before saving any media or draft', async () => {
  const f = fixture();
  const scene = await sharp({create:{width:1080,height:1350,channels:3,background:'#82A0B2'}}).jpeg().toBuffer();
  await assert.rejects(f.create({
    format:'carousel',
    source:'autonomous_agent',
    renderImage:async()=>scene,
    verifyArtwork:async(_image, params)=>{
      if (params.title==='Headline 3') throw new ApiError(422,'Visual otomatis perlu diperiksa.','scheduled_artwork_rejected');
    },
  }), error => error instanceof ApiError && error.code==='scheduled_artwork_rejected');
  assert.equal(f.blobs.size,0);
  assert.equal([...f.database.values.keys()].some(key=>key.startsWith(`${f.ref.path}/social_drafts/`)),false);
});

test('an Otonom carousel repairs and verifies only the rejected slide without changing its copy or direction',async()=>{
 const f=fixture();
 const scene=await sharp({create:{width:1080,height:1350,channels:3,background:'#82A0B2'}}).jpeg().toBuffer();
 const renders:SocialPostImageParams[]=[];
 const verified:SocialPostImageParams[]=[];
 const {draft}=await f.create({format:'carousel',source:'autonomous_agent',renderImage:async params=>{renders.push(params);return scene;},verifyArtwork:async(_,params)=>{
  verified.push(params);
  assert.equal(f.blobs.size,0);
  if(params.title==='Headline 3'&&!params.scheduledArtworkRepair)throw new ApiError(422,'Visual ditolak','scheduled_artwork_rejected');
 }});
 const {scheduledArtworkRepair,...repaired}=renders.find(item=>item.scheduledArtworkRepair)!;
 assert.equal(scheduledArtworkRepair,true);
 assert.deepEqual(repaired,renders.find(item=>item.title==='Headline 3'));
 assert.equal(verified.filter(item=>item.title==='Headline 3').length,2);
 assert.equal(renders.length,6);
 assert.equal(draft.renderedSlides?.length,5);
 assert.equal(f.generationCount(),1);
});

test('carousel rejects a source asset before generation or quota use', async () => {
  const f = fixture();
  await assert.rejects(f.create({ format: 'carousel', sourceAssetId: '123e4567-e89b-42d3-a456-426614174000' }), error => error instanceof ApiError && error.status === 400);
  assert.equal(f.generateCalls(), 0);
  assert.equal(f.generationCount(), 0);
  assert.equal(f.blobs.size, 0);
});

test('carousel image failure waits for every render and creates no authoritative draft', async () => {
  const f = fixture();
  const rendered: string[] = [];
  await assert.rejects(f.create({
    format: 'carousel',
    renderImage: async params => {
      rendered.push(params.title);
      if (params.title === 'Headline 3') throw new Error('provider details must not escape');
      return sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    },
  }), error => error instanceof ApiError && error.status === 502 && !error.message.includes('provider details'));
  assert.equal(rendered.length, 5);
  assert.equal(f.blobs.size, 0);
  assert.equal([...f.database.values.keys()].some(key => key.startsWith(`${f.ref.path}/social_drafts/`)), false);
  assert.equal(f.generationCount(), 1);
});

test('carousel publishes five ordered trusted slides to both bound channels and skips a successful retry', async () => {
  const f = fixture(); const { draft } = await f.create({ format: 'carousel' });
  const record = f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;
  const calls: any[] = [];
  const carouselPublisher = async (input: any) => {
    calls.push(input);
    return { externalPostId: `remote-${input.channel}`, permalink: `https://example.test/${input.channel}` };
  };
  const result = await publishSocialContent(f.request(draft.id), { ...f.dependencies, carouselPublisher });
  assert.equal(result.draft.status, 'published');
  assert.deepEqual(result.receipts.map(receipt => [receipt.channel, receipt.externalPostId]), [['facebook', 'remote-facebook'], ['instagram', 'remote-instagram']]);
  assert.deepEqual(calls.map(input => [input.channel, input.accountId]), [['facebook', '100'], ['instagram', '200']]);
  for (const input of calls) {
    assert.deepEqual(input.images.map((image: any) => image.imageUrl), draft.renderedSlides!.map(slide => slide.url));
    assert.deepEqual(input.images.map((image: any) => image.imageBytes), record.storagePaths.map((path: string) => f.blobs.get(path)));
  }
  assert.equal(f.count(), 1);
  await publishSocialContent(f.request(draft.id), { ...f.dependencies, carouselPublisher });
  assert.equal(calls.length, 2);
  assert.equal(f.count(), 1);
});

test('carousel missing or cross-workspace storage paths are rejected before dispatch and quota use', async () => {
  for (const corrupt of ['missing', 'cross-workspace']) {
    const f = fixture(); const { draft } = await f.create({ format: 'carousel' });
    const record = f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;
    const storagePaths = [...record.storagePaths];
    if (corrupt === 'missing') storagePaths.pop();
    else storagePaths[0] = 'workspaces/another-workspace/renders/slide.jpg';
    f.database.write(f.ref.collection('social_drafts').doc(draft.id), { storagePaths });
    let calls = 0;
    await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, carouselPublisher: async () => { calls++; return { externalPostId: 'unexpected' }; } }), error => error instanceof ApiError && error.status === 409);
    assert.equal(calls, 0);
    assert.equal(f.count(), 0);
  }
});

test('partial carousel failure retries only the failed channel and consumes one posting quota', async () => {
  const f = fixture(); const { draft } = await f.create({ format: 'carousel' }); const calls: string[] = []; let fail = true;
  const carouselPublisher = async (input: any) => {
    calls.push(input.channel);
    if (input.channel === 'instagram' && fail) throw new MetaRequestError('permission rejected', false);
    return { externalPostId: `remote-${input.channel}` };
  };
  const partial = await publishSocialContent(f.request(draft.id), { ...f.dependencies, carouselPublisher });
  assert.equal(partial.draft.status, 'partially_published'); assert.equal(f.count(), 1);
  fail = false;
  const success = await publishSocialContent(f.request(draft.id), { ...f.dependencies, carouselPublisher });
  assert.equal(success.draft.status, 'published'); assert.deepEqual(calls, ['facebook', 'instagram', 'instagram']); assert.equal(f.count(), 1);
});

test('partial failure retries only the failed channel and consumes one posting quota', async () => {
  const f = fixture(); const { draft } = await f.create(); const calls: string[] = []; let fail = true;
  const publisher = async (input: any) => {
    calls.push(input.channel);
    if (input.channel === 'instagram' && fail) throw new MetaRequestError('permission rejected', false);
    return { externalPostId: `remote-${input.channel}` };
  };
  const partial = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  assert.equal(partial.draft.status, 'partially_published'); assert.equal(f.count(), 1);
  fail = false;
  const success = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  assert.equal(success.draft.status, 'published'); assert.deepEqual(calls, ['facebook', 'instagram', 'instagram']); assert.equal(f.count(), 1);
});

test('uncertain delivery keeps quota reserved and blocks resend', async () => {
  const f = fixture(); const { draft } = await f.create(); let calls = 0;
  const publisher = async () => { calls++; throw new MetaRequestError('timeout after sending', true); };
  const result = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  assert.equal(result.draft.status, 'needs_attention'); assert.equal(f.count(), 1);
  await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher }), error => error instanceof ApiError && error.status === 409);
  assert.equal(calls, 2);
});

test('definitive failure on every channel releases quota for a later valid retry', async () => {
  const f = fixture(); const { draft } = await f.create();
  const result = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher: async () => { throw new MetaRequestError('permission rejected'); } });
  assert.equal(result.draft.status, 'publish_failed'); assert.equal(f.count(), 0);
});

test('a lost receipt write after a successful send cannot trigger a duplicate', async () => {
  const f = fixture(); const { draft } = await f.create(); let calls = 0;
  f.database.failReceiptWrite = true;
  const publisher = async () => { calls++; return { externalPostId: 'confirmed-remote-id' }; };
  await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher }), /Periksa akun Meta/);
  f.database.failReceiptWrite = false;
  await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher }), /Jangan kirim ulang/);
  assert.equal(calls, 1);
});

test('concurrent requests for the same draft dispatch only once', async () => {
  const f = fixture(); const { draft } = await f.create(); let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; }); let calls = 0;
  const publisher = async () => { calls++; started(); await gate; return { externalPostId: `remote-${calls}` }; };
  const first = publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  await entered;
  await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher }), /Jangan kirim ulang/);
  release(); await first;
  assert.equal(calls, 2); assert.equal(f.count(), 1);
});

test('another tenant and client-forged quota/plan cannot authorize a publish', async () => {
  const f = fixture(); const { draft } = await f.create();
  const wrongActor = async () => ({ ref: f.ref, user: { uid: 'customer-b' }, workspaceId: f.ref.id, workspace: (await f.ref.get()).data()! });
  await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, authorize: wrongActor as never, publisher: async () => { assert.fail('must not send'); } }), error => error instanceof ApiError && error.status === 403);
  const forged = new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: f.ref.id, draftId: draft.id, planId: 'pro_1500k', postsPublishedThisMonth: 0 }) });
  await assert.rejects(publishSocialContent(forged, f.dependencies));
  assert.equal(f.count(), 0);
});

test('changing the selected Page after creation cannot redirect an already-reviewed draft', async () => {
  const f = fixture(); const { draft } = await f.create();
  await f.ref.collection('private_meta_connections').doc('facebook').update({ accountId: '999', accountName: 'Different customer Page' });
  await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher: async () => { assert.fail('must not dispatch to any account'); } }), error => error instanceof ApiError && error.code === 'target_changed');
  assert.equal(f.count(), 0);
});


function seedExtraInstagram(f:ReturnType<typeof fixture>){
 f.database.values.set(`${f.ref.path}/private_meta_connections/instagram_201`,{channel:'instagram',accountId:'201',pageId:'101',accountName:'Second IG',handle:'@second',encryptedToken:'unit-second-placeholder',expiresAt:0});
 return ['instagram_200','instagram_201','facebook_100'];
}
test('autonomous retry preserves successful and permanently rejected targets and only retries temporary failures',async()=>{
 const f=fixture();
 const {draft}=await f.create({selectedConnectionIds:seedExtraInstagram(f)});
 const sends:string[]=[];
 const publisher=async({accountId}:{accountId:string})=>{
  sends.push(accountId);
  if(accountId==='201'&&sends.filter(id=>id==='201').length===1)throw new MetaRequestError('Temporary',false,4,true);
  if(accountId==='100')throw new MetaRequestError('Permanent',false,100);
  return{externalPostId:`confirmed-${accountId}`};
 };
 const first=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher,stopOnUnknown:true});
 assert.deepEqual(first.receipts.map(receipt=>[receipt.accountId,receipt.status,receipt.retryable??false]),[['200','published',false],['201','failed',true],['100','failed',false]]);
 const retry=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher,retryTransientFailures:true,stopOnUnknown:true});
 assert.deepEqual(sends,['200','201','100','201']);
 assert.equal(retry.draft.status,'partially_published');
 assert.equal(f.count(),1);
});

test('an ambiguous automated send blocks other sends and cannot become a retryable target',async()=>{
 const f=fixture();
 const {draft}=await f.create({selectedConnectionIds:seedExtraInstagram(f)});
 let calls=0;
 const publisher=async()=>{calls++;throw new MetaRequestError('Lost POST response',true,4,true);};
 const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher,stopOnUnknown:true});
 assert.equal(result.draft.status,'needs_attention');
 assert.equal(result.receipts[0].retryable,undefined);
 await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,publisher,retryTransientFailures:true}),{code:'delivery_in_progress'});
 assert.equal(calls,1);
 assert.equal(f.count(),1);
});

test('multi-account dispatch persists two Instagram receipts and a Facebook receipt with one quota',async()=>{
 const f=fixture();const ids=seedExtraInstagram(f);const{draft}=await f.create({selectedConnectionIds:ids});const sent:string[]=[];
 assert.deepEqual(draft.publishTargets?.map(target=>target.connectionId),ids);assert.equal(draft.channelStatuses.length,3);assert.equal(f.generateCalls(),1);assert.equal(f.renderCalls(),1);
 const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async params=>{sent.push(params.accountId);return{externalPostId:'remote-'+params.accountId};}});
 assert.deepEqual(sent,['200','201','100']);assert.equal(result.receipts.length,3);assert.equal(new Set(result.receipts.map(item=>item.connectionId)).size,3);assert.equal(result.draft.status,'published');assert.equal(f.count(),1);
});
test('retry skips a successful Instagram account even when that completed target is later disconnected',async()=>{
 const f=fixture();const{draft}=await f.create({selectedConnectionIds:seedExtraInstagram(f)});let failed=true;const sent:string[]=[];const publisher=async(params:{accountId:string})=>{sent.push(params.accountId);if(params.accountId==='201'&&failed)throw new MetaRequestError('Definite rejection');return{externalPostId:'remote-'+params.accountId};};
 const first=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});assert.equal(first.draft.status,'partially_published');assert.equal(f.count(),1);
 f.database.values.delete(`${f.ref.path}/private_meta_connections/instagram`);failed=false;const second=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});assert.equal(second.draft.status,'published');assert.deepEqual(sent,['200','201','100','201']);assert.equal(f.count(),1);
});
test('unknown delivery for one of several Instagram accounts blocks automatic duplicate retry',async()=>{
 const f=fixture();const{draft}=await f.create({selectedConnectionIds:seedExtraInstagram(f)});let calls=0;const publisher=async(params:{accountId:string})=>{calls++;if(params.accountId==='201')throw new MetaRequestError('Unknown send',true);return{externalPostId:'remote-'+params.accountId};};
 const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});assert.equal(result.draft.status,'needs_attention');await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,publisher}),error=>error instanceof ApiError&&error.code==='delivery_in_progress');assert.equal(calls,3);assert.equal(f.count(),1);
});
test('duplicate, foreign, expired and implicit multi-account targets fail before generation cost',async()=>{
 for(const mode of ['duplicate','foreign','expired','implicit'] as const){const f=fixture();const ids=seedExtraInstagram(f);if(mode==='expired')f.database.values.get(`${f.ref.path}/private_meta_connections/instagram_201`)!.expiresAt=Date.now()-1;
 await assert.rejects(f.create({selectedConnectionIds:mode==='duplicate'?[ids[0],ids[0]]:mode==='foreign'?['instagram_999']:mode==='implicit'?undefined:ids}));assert.equal(f.generateCalls(),0);assert.equal(f.generationCount(),0);}
});
test('legacy draft and channel-only job receipts retain original targets and do not duplicate delivery',async()=>{
 const f=fixture();const{draft}=await f.create();const saved=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;delete saved.targetBindings;
 saved.draft.publishTargets=saved.draft.publishTargets.map(({channel,accountId,accountName,handle}:any)=>({channel,accountId,accountName,handle}));
 let calls=0;const publisher=async()=>({externalPostId:'remote-'+(++calls)});await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});const job=f.database.values.get(`${f.ref.path}/publish_jobs/${draft.id}`)!;job.receipts=job.receipts.map(({channel,status,externalPostId}:any)=>({channel,status,externalPostId}));
 const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});assert.equal(calls,2);assert.equal(result.receipts.length,2);assert.equal(f.count(),1);
});
test('disconnect while loading media is rechecked before that remote send',async()=>{
 const f=fixture();const{draft}=await f.create({selectedConnectionIds:seedExtraInstagram(f)});const original=f.dependencies.storage as unknown as {file:(path:string)=>{download:()=>Promise<Buffer[]>}};let removed=false;const sent:string[]=[];
 const storage={...original,file:(path:string)=>({download:async()=>{const bytes=await original.file(path).download();if(!removed){removed=true;f.database.values.delete(`${f.ref.path}/private_meta_connections/instagram`);}return bytes;}})};
 const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,storage:storage as never,publisher:async params=>{sent.push(params.accountId);return{externalPostId:'remote-'+params.accountId};}});assert.equal(result.draft.status,'partially_published');assert.deepEqual(sent,['201','100']);
});


test('ten Instagram destinations drain a persisted queue across requests without duplicate sends or quota',async()=>{
 const f=fixture();const ids=Array.from({length:10},(_,i)=>'instagram_'+(9000+i));for(const [i,id]of ids.entries())f.database.values.set(`${f.ref.path}/private_meta_connections/${id}`,{channel:'instagram',accountId:String(9000+i),pageId:'100',accountName:'Brand '+i,handle:'@brand'+i,encryptedToken:'unit-placeholder',expiresAt:0});
 const{draft}=await f.create({selectedConnectionIds:ids});const sent:string[]=[];const publisher=async(params:{accountId:string})=>{sent.push(params.accountId);return{externalPostId:'remote-'+params.accountId};};
 let result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});assert.equal(result.draft.status,'publish_queued');assert.equal(result.receipts.length,3);assert.equal(result.pendingAccounts,7);assert.equal(f.count(),1);
 for(let batch=0;result.hasMore&&batch<5;batch++)result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});
 assert.equal(result.draft.status,'published');assert.equal(sent.length,10);assert.equal(new Set(sent).size,10);assert.equal(f.count(),1);assert.equal(result.draft.channelStatuses.length,10);
});
test('elapsed request budget checkpoints remaining accounts and never retries a failed one during continuation',async()=>{
 const f=fixture();const{draft}=await f.create({selectedConnectionIds:seedExtraInstagram(f)});let clock=0;const sent:string[]=[];const publisher=async(params:{accountId:string})=>{sent.push(params.accountId);clock+=61_000;if(params.accountId==='200')throw new MetaRequestError('Definitive reject');return{externalPostId:'remote-'+params.accountId};};
 let result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher,now:()=>clock});assert.equal(result.hasMore,true);assert.equal(result.receipts.length,1);assert.equal(f.count(),1);
 while(result.hasMore)result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher,now:()=>clock});assert.deepEqual(sent,['200','201','100']);assert.equal(result.draft.status,'partially_published');assert.equal(f.count(),1);
});


test('disconnecting a queued destination does not block other accounts or resend completed ones',async()=>{
 const f=fixture();const ids=Array.from({length:5},(_,i)=>'instagram_'+(9000+i));for(const [i,id]of ids.entries())f.database.values.set(`${f.ref.path}/private_meta_connections/${id}`,{channel:'instagram',accountId:String(9000+i),pageId:'100',accountName:'Brand '+i,handle:'@brand'+i,encryptedToken:'unit-placeholder',expiresAt:0});
 const{draft}=await f.create({selectedConnectionIds:ids});const sent:string[]=[];const publisher=async(params:{accountId:string})=>{sent.push(params.accountId);return{externalPostId:'remote-'+params.accountId};};
 const first=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});assert.equal(first.hasMore,true);f.database.values.delete(`${f.ref.path}/private_meta_connections/instagram_9003`);
 const last=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher});assert.equal(last.draft.status,'partially_published');assert.deepEqual(sent,['9000','9001','9002','9004']);assert.equal(last.receipts.find(item=>item.connectionId==='instagram_9003')?.status,'failed');assert.equal(f.count(),1);
});

const secondaryBusinessId='b_123e4567-e89b-42d3-a456-426614174999';
async function seedBusinessContexts(f:ReturnType<typeof fixture>){
 const {blankBusinessProfile}=await import('../business-context');
 f.database.values.set(`${f.ref.path}/business_contexts/primary`,{revision:1,connectionIds:['facebook_100']});
 const brand=blankBusinessProfile(f.ref.id,secondaryBusinessId,'Cendekia AI');brand.businessDescription='Platform pembelajaran.';
 f.database.values.set(`${f.ref.path}/business_contexts/${secondaryBusinessId}`,{revision:1,brand,connectionIds:['instagram_200']});return brand;
}
test('business generation resolves selected saved profile and rejects cross-business account before quota',async()=>{
 const f=fixture();const brand=await seedBusinessContexts(f);
 await assert.rejects(f.create({businessId:'primary',selectedConnectionIds:['instagram_200']}),(error:any)=>error.code==='business_target_mismatch');assert.equal(f.generationCount(),0);
 const {draft}=await f.create({businessId:secondaryBusinessId,selectedConnectionIds:['instagram_200'],generate:async input=>{assert.equal(input.brand.businessName,'Cendekia AI');assert.equal(input.brand.businessId,secondaryBusinessId);return{draft:shortVisualDraft(input),engineMode:'deterministic_local'};}});
 assert.equal(draft.businessId,secondaryBusinessId);assert.equal(draft.publishTargets?.[0].accountId,'200');assert.equal(f.generationCount(),1);assert.equal(draft.profileContext?.fingerprint,await profileFingerprint(brand));
});
test('unknown business and foreign photo fail before generation quota',async()=>{
 const f=fixture();await seedBusinessContexts(f);await seedPhoto(f);
 await assert.rejects(f.create({businessId:'b_00000000-0000-0000-0000-000000000000',selectedConnectionIds:['instagram_200']}),(error:any)=>error.code==='business_context_invalid');
 await assert.rejects(f.create({businessId:secondaryBusinessId,selectedConnectionIds:['instagram_200'],referenceAssetIds:[photoId]}),(error:any)=>error.status===404);assert.equal(f.generationCount(),0);
});
test('reassigned business destination blocks publication and quota reservation',async()=>{
 const f=fixture();await seedBusinessContexts(f);const {draft}=await f.create({businessId:secondaryBusinessId,selectedConnectionIds:['instagram_200']});
 f.database.values.set(`${f.ref.path}/business_contexts/primary`,{revision:2,connectionIds:['facebook_100','instagram_200']});const secondary=f.database.values.get(`${f.ref.path}/business_contexts/${secondaryBusinessId}`)!;secondary.connectionIds=[];secondary.revision=2;
 let calls=0;await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async()=>{calls++;return{externalPostId:'forbidden'};}}),(error:any)=>error.code==='business_target_mismatch');assert.equal(calls,0);assert.equal(f.count(),0);
});
test('publication checks correct business rules rather than workspace primary words',async()=>{
 const f=fixture();await seedBusinessContexts(f);const {draft}=await f.create({businessId:secondaryBusinessId,selectedConnectionIds:['instagram_200']});
 const workspace=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(workspace.snapshotJson);snapshot.brand.forbiddenWords=[draft.caption.split(' ')[0]];workspace.snapshotJson=JSON.stringify(snapshot);
 let calls=0;const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async()=>{calls++;return{externalPostId:'correct-business'};}});assert.equal(calls,1);assert.equal(result.draft.status,'published');
});
test('business reassignment during media read is caught before dispatch and releases definitive failure quota',async()=>{
 const f=fixture();await seedBusinessContexts(f);const {draft}=await f.create({businessId:secondaryBusinessId,selectedConnectionIds:['instagram_200']});let calls=0;
 const storage={file:(key:string)=>({download:async()=>{const primary=f.database.values.get(`${f.ref.path}/business_contexts/primary`)!;primary.connectionIds.push('instagram_200');f.database.values.get(`${f.ref.path}/business_contexts/${secondaryBusinessId}`)!.connectionIds=[];return (f.dependencies.storage as any).file(key).download();}})};
 const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,storage:storage as never,publisher:async()=>{calls++;return{externalPostId:'forbidden'};}});assert.equal(calls,0);assert.equal(result.draft.status,'publish_failed');assert.equal(f.count(),0);assert.match(result.receipts[0].error||'',/bisnis/);
});

test('business profile API keeps primary intact, enforces revision and prevents duplicate account assignment',async()=>{
 const {createBusiness,updateBusiness}=await import('./business-contexts');const f=fixture();const original=f.database.values.get(f.ref.path)!.snapshotJson;
 const req=(value:object)=>new Request('http://localhost/api',{method:'POST',body:JSON.stringify({workspaceId:f.ref.id,...value})});
 const created=await createBusiness(req({name:'Cendekia AI'}),{authorize:f.authorize as never});const id=created.businessId;
 assert.equal(created.businesses.length,2);assert.equal(created.businesses[1].brand.logoAssetId,undefined);assert.deepEqual(created.businesses[1].brand.offerings,[]);assert.equal(f.database.values.get(f.ref.path)!.snapshotJson,original);
 await updateBusiness(req({businessId:id,expectedRevision:1,connectionIds:['instagram_200']}),{authorize:f.authorize as never});
 await assert.rejects(updateBusiness(req({businessId:id,expectedRevision:1,connectionIds:[]}),{authorize:f.authorize as never}),(error:any)=>error.code==='business_conflict');
 await assert.rejects(updateBusiness(req({businessId:'primary',expectedRevision:0,connectionIds:['instagram_200']}),{authorize:f.authorize as never}),(error:any)=>error.code==='business_assignment_conflict');
 await assert.rejects(updateBusiness(req({businessId:id,expectedRevision:2,schedule:{connectionIds:['facebook_100'],timesWib:['08:00'],days:['Sen']}}),{authorize:f.authorize as never}),(error:any)=>error.status===400);
 const result=await updateBusiness(req({businessId:id,expectedRevision:2,profile:{...created.businesses[1].brand,businessDescription:'Materi belajar',primaryColorHex:'#008844'},schedule:{connectionIds:['instagram_200'],timesWib:['09:00'],days:['Sen']}}),{authorize:f.authorize as never});assert.equal(result.businesses[1].brand.primaryColorHex,'#008844');assert.deepEqual(result.businesses[1].schedule.connectionIds,['instagram_200']);assert.equal(f.database.values.get(f.ref.path)!.snapshotJson,original);
});
test('business create rechecks workspace owner inside transaction',async()=>{
 const {createBusiness}=await import('./business-contexts');const f=fixture();const authorize=async(request:Request,id:unknown)=>{const value=await f.authorize(request,id);f.database.values.get(f.ref.path)!.ownerUid='new-owner';return value;};
 await assert.rejects(createBusiness(new Request('http://localhost/api',{method:'POST',body:JSON.stringify({workspaceId:f.ref.id,name:'New business'})}),{authorize:authorize as never}),(error:any)=>error.status===403);assert.equal([...f.database.values.keys()].filter(key=>key.includes('/business_contexts/')).length,0);
});
test('business photo list, palette and recoverable delete reject other business media',async()=>{
 const f=fixture();await seedPhoto(f);await seedBusinessContexts(f);
 assert.equal((await listWorkspacePhotos(new Request('http://localhost'),f.ref.id,true,{authorize:f.authorize as never},secondaryBusinessId)).length,0);
 await assert.rejects(changeWorkspacePhotoState(new Request('http://localhost/api',{method:'PATCH',body:JSON.stringify({workspaceId:f.ref.id,businessId:secondaryBusinessId,assetId:photoId,action:'trash'})}),{authorize:f.authorize as never}),(error:any)=>error.status===404);
 await assert.rejects(analyzeBrandLogo(new Request('http://localhost/api',{method:'POST',body:JSON.stringify({workspaceId:f.ref.id,businessId:secondaryBusinessId,assetId:photoId})}),{authorize:f.authorize as never,storage:f.dependencies.storage as never}),(error:any)=>error.status===404);
 assert.equal(f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!.trashedAt,undefined);
});
test('queued multi-account publication fails only a destination moved to another business',async()=>{
 const f=fixture();await seedBusinessContexts(f);const ids=['instagram_200','instagram_201','instagram_202','instagram_203','instagram_204'];
 for(let index=201;index<=204;index++)f.database.values.set(`${f.ref.path}/private_meta_connections/instagram_${index}`,{channel:'instagram',accountId:String(index),pageId:'',accountName:'Brand',handle:'@'+index,loginProvider:'instagram_unified',encryptedToken:'test-ciphertext',expiresAt:Date.now()+60000});
 const secondary=f.database.values.get(`${f.ref.path}/business_contexts/${secondaryBusinessId}`)!;secondary.connectionIds=ids;
 const{draft}=await f.create({businessId:secondaryBusinessId,selectedConnectionIds:ids});const calls:string[]=[];const dependencies={...f.dependencies,publisher:async(input:any)=>{calls.push(input.accountId);return{externalPostId:'post-'+input.accountId};}};
 const first=await publishSocialContent(f.request(draft.id),dependencies);assert.equal(first.hasMore,true);assert.equal(calls.length,3);
 secondary.connectionIds=ids.filter(id=>id!=='instagram_203');f.database.values.get(`${f.ref.path}/business_contexts/primary`)!.connectionIds.push('instagram_203');
 const final=await publishSocialContent(f.request(draft.id),dependencies);assert.equal(final.draft.status,'partially_published');assert.deepEqual(calls,['200','201','202','204']);assert.equal(f.count(),1);assert.match(final.receipts.find(item=>item.accountId==='203')?.error||'',/bisnis/);
});

test('explicit primary unassignment blocks a legacy draft rather than silently reclaiming its account',async()=>{
 const f=fixture();const {draft}=await f.create({selectedConnectionIds:['instagram_200']});assert.equal(draft.businessId,undefined);
 f.database.values.set(`${f.ref.path}/business_contexts/primary`,{revision:1,connectionIds:[]});
 await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,publisher:async()=>{throw new Error('must not send');}}),(error:any)=>error.code==='business_target_mismatch');assert.equal(f.count(),0);
});

test('profile API rejects foreign, trashed and wrong-workspace logos, accepts only own business asset',async()=>{
 const {updateBusiness}=await import('./business-contexts');const f=fixture();const brand=await seedBusinessContexts(f);await seedPhoto(f);
 const req=(logoAssetId:string)=>new Request('http://localhost/api',{method:'PATCH',body:JSON.stringify({workspaceId:f.ref.id,businessId:secondaryBusinessId,expectedRevision:1,profile:{...brand,logoAssetId}})});
 await assert.rejects(updateBusiness(req(photoId),{authorize:f.authorize as never}),(error:any)=>error.code==='business_logo_mismatch');
 const id='123e4567-e89b-42d3-a456-426614174001';const asset=structuredClone(f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!);asset.asset={...asset.asset,id,businessId:secondaryBusinessId};asset.storagePath=`workspaces/${f.ref.id}/vault/${id}.jpg`;asset.trashedAt=Date.now();f.database.values.set(`${f.ref.path}/server_assets/${id}`,asset);
 await assert.rejects(updateBusiness(req(id),{authorize:f.authorize as never}),(error:any)=>error.code==='business_logo_mismatch');delete asset.trashedAt;asset.asset.workspaceId='foreign-workspace';
 await assert.rejects(updateBusiness(req(id),{authorize:f.authorize as never}),(error:any)=>error.code==='business_logo_mismatch');asset.asset.workspaceId=f.ref.id;
 const result=await updateBusiness(req(id),{authorize:f.authorize as never});assert.equal(result.businesses.find(item=>item.id===secondaryBusinessId)!.brand.logoAssetId,id);assert.equal(f.database.values.get(`${f.ref.path}/business_contexts/${secondaryBusinessId}`)!.revision,2);
});
test('primary profile server save preserves snapshot and quota, returns CAS revision, rejects stale fingerprint and foreign logo',async()=>{
 const {updateBusiness}=await import('./business-contexts');const f=fixture();await seedPhoto(f);const workspace=f.database.values.get(f.ref.path)!;workspace.snapshotRevision=7;const snapshot=JSON.parse(workspace.snapshotJson);snapshot.existingData={keep:true};snapshot.drafts=[{id:'keep-this-draft'}];workspace.snapshotJson=JSON.stringify(snapshot);const fingerprint=await profileFingerprint(snapshot.brand);
 const req=(profile:object,expectedRevision=0,expectedProfileFingerprint=fingerprint)=>new Request('http://localhost/api',{method:'PATCH',body:JSON.stringify({workspaceId:f.ref.id,businessId:'primary',expectedRevision,expectedProfileFingerprint,profile})});
 const result=await updateBusiness(req({...snapshot.brand,businessName:'Berez Updated',logoAssetId:photoId}),{authorize:f.authorize as never});assert.equal(result.workspaceSnapshotRevision,8);const saved=f.database.values.get(f.ref.path)!;assert.equal(saved.ownerUid,'customer-a');assert.equal(saved.quotaUsed,0);assert.equal(saved.snapshotRevision,8);const fresh=JSON.parse(saved.snapshotJson);assert.deepEqual(fresh.existingData,{keep:true});assert.deepEqual(fresh.drafts,snapshot.drafts);assert.equal(fresh.brand.businessName,'Berez Updated');assert.equal(fresh.brand.businessId,undefined);assert.equal('brand' in f.database.values.get(`${f.ref.path}/business_contexts/primary`)!,false);
 await assert.rejects(updateBusiness(req({...snapshot.brand,businessName:'stale'},1),{authorize:f.authorize as never}),(error:any)=>error.code==='profile_conflict');assert.equal(f.database.values.get(f.ref.path)!.snapshotRevision,8);
 const foreignId='123e4567-e89b-42d3-a456-426614174002';const foreign=structuredClone(f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!);foreign.asset={...foreign.asset,id:foreignId,businessId:secondaryBusinessId};foreign.storagePath=`workspaces/${f.ref.id}/vault/${foreignId}.jpg`;f.database.values.set(`${f.ref.path}/server_assets/${foreignId}`,foreign);
 await assert.rejects(updateBusiness(req({...fresh.brand,logoAssetId:foreignId},1,await profileFingerprint(fresh.brand)),{authorize:f.authorize as never}),(error:any)=>error.code==='business_logo_mismatch');assert.equal(f.database.values.get(f.ref.path)!.snapshotRevision,8);
});


test('asset category CAS isolates businesses, blocks stale and trashed assets, and preserves private bytes',async()=>{
 const{updateAssetKind}=await import('./asset-kind');const f=fixture();await seedPhoto(f);const req=(extra={})=>new Request('http://local',{method:'PATCH',body:JSON.stringify({workspaceId:f.ref.id,businessId:'primary',assetId:photoId,expectedRevision:0,category:'logo',...extra})});const deps={authorize:f.authorize as never};
 const result=await updateAssetKind(req(),deps);assert.equal(result.category,'logo');assert.equal(result.metadataRevision,1);assert.match(result.previewUrl,/^\/api\/veloxa\/media\/preview/);assert.equal(f.generationCount(),0);
 await assert.rejects(updateAssetKind(req(),deps),/berubah/);await assert.rejects(updateAssetKind(req({businessId:'biz_missing',expectedRevision:1}),deps));
 const stored=f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!;stored.trashedAt=1;await assert.rejects(updateAssetKind(req({expectedRevision:1}),deps),/tidak tersedia/);stored.trashedAt=null;
 f.database.values.get(f.ref.path)!.ownerUid='other';await assert.rejects(updateAssetKind(req({expectedRevision:1}),deps),/Akses/);assert.equal(stored.asset.metadataRevision,1);
});
test('asset AI recognition is readonly, leased, validates output and discards revoked or outdated suggestions',async()=>{
 const{analyzeAssetKind,updateAssetKind}=await import('./asset-kind');for(const mutation of['none','revision','owner','trash','invalid']as const){const f=fixture();await seedPhoto(f);const body={workspaceId:f.ref.id,businessId:'primary',assetId:photoId,expectedRevision:0};const req=()=>new Request('http://local',{method:'POST',body:JSON.stringify(body)});let started=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const deps={authorize:f.authorize as never,storage:f.dependencies.storage,recognize:async(bytes:Buffer)=>{assert.ok(bytes.length>100);started++;await gate;return mutation==='invalid'?{category:'unknown'}:{category:'logo',confidence:0.9,reason:'Wordmark mendominasi gambar.'};}};
 const pending=analyzeAssetKind(req(),deps);while(!started)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(analyzeAssetKind(req(),deps),/masih berjalan/);
 if(mutation==='revision')await updateAssetKind(new Request('http://local',{method:'PATCH',body:JSON.stringify({...body,category:'product'})}),deps);
 if(mutation==='owner')f.database.values.get(f.ref.path)!.ownerUid='other';if(mutation==='trash')f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!.trashedAt=1;release();
 if(mutation==='none'){const proposal=await pending;assert.equal(proposal.category,'logo');assert.equal(f.database.values.get(`${f.ref.path}/server_assets/${photoId}`)!.asset.category,undefined);}else await assert.rejects(pending);
 assert.equal(f.database.values.has(`${f.ref.path}/asset_analysis_jobs/${photoId}`),false);assert.equal(f.generationCount(),0);
 }
});
async function adFixture(){const f=fixture();const snap=JSON.parse(f.database.values.get(f.ref.path)!.snapshotJson);f.database.values.set(`${f.ref.path}/business_contexts/primary`,{revision:1,connectionIds:['instagram_200']});const source={id:'draft_ads_a',workspaceId:f.ref.id,businessId:'primary',title:'Kontrol stok ERP',caption:'Pantau persediaan melalui Berez.',format:'single_post',status:'published',channelStatuses:[{channel:'instagram',connectionId:'instagram_200',status:'published'}],publishTargets:[{channel:'instagram',connectionId:'instagram_200',accountId:'200'}],organicMetrics:{likes:999999999}};f.database.values.set(`${f.ref.path}/social_drafts/${source.id}`,{draft:source,createdAt:100});f.database.values.set(`${f.ref.path}/publish_jobs/${source.id}`,{receipts:[{connectionId:'instagram_200',status:'published',externalPostId:'200_123'}]});const body={workspaceId:f.ref.id,businessId:'primary',profileFingerprint:await profileFingerprint(snap.brand),connectionIds:['instagram_200'],mode:'manual',sourceDraftId:source.id,dailyCap:75000,totalCap:300000,maxDuration:7,goal:''};const req=(extra={})=>new Request('http://local',{method:'POST',body:JSON.stringify({...body,...extra})});const strategy={objective:'WEBSITE_CONVERSIONS',summary:'Kenalkan ERP.',sourceReason:'Sesuai penawaran.',audience:'Pemilik toko',location:'Indonesia',ageMin:18,ageMax:65,interests:['Bisnis'],dailyBudgetIdr:100000,durationDays:30,budgetReason:'Uji bertahap.',creativeAngle:'Demo',testingPlan:['Tinjau hasil'],questions:['Pastikan website']};return{...f,source,req,strategy};}
test('ad planner uses authoritative business content and enforces caps without creating or spending an ad',async()=>{
 const{planBusinessAds}=await import('./ad-planning');const f=await adFixture();let calls=0;const result=await planBusinessAds(f.req(),{authorize:f.authorize as never,suggest:async brief=>{calls++;assert.equal(brief.source.title,f.source.title);return f.strategy;}});assert.equal(calls,1);assert.equal(result.sourceDraftId,f.source.id);assert.ok(result.strategy.dailyBudgetIdr<=75000);assert.ok(result.strategy.dailyBudgetIdr*result.strategy.durationDays<=300000);assert.equal(f.database.values.has(`${f.ref.path}/ad_planning_jobs/primary`),false);assert.equal(f.count(),0);assert.equal(f.generationCount(),0);assert.equal([...f.database.values.keys()].some(key=>key.includes('/campaigns/')),false);
 await assert.rejects(planBusinessAds(f.req({sourceDraftId:'draft_foreign'}),{authorize:f.authorize as never,suggest:async()=>{throw Error('must not call');}}),/milik bisnis/);
 await assert.rejects(planBusinessAds(f.req({connectionIds:['facebook_100']}),{authorize:f.authorize as never}),/bisnis ini/);await assert.rejects(planBusinessAds(f.req({profileFingerprint:'0'.repeat(64)}),{authorize:f.authorize as never}),/berubah/);
});
test('ad planner ignores demo engagement and only GETs real receipt metrics; missing metrics require manual choice',async()=>{
 const{planBusinessAds}=await import('./ad-planning');for(const missing of[true,false]){const f=await adFixture();let reads=0;const deps={authorize:f.authorize as never,decrypt:()=> 'private-test',graph:(async(path:string,_token:string,method:string,params:any)=>{reads++;assert.equal(path,'200_123');assert.equal(method,'GET');assert.match(params.fields,/like_count/);return missing?{}:{like_count:4,comments_count:2};})as never,suggest:async()=>f.strategy};if(missing)await assert.rejects(planBusinessAds(f.req({mode:'performance'}),deps),error=>error instanceof ApiError&&error.code==='ad_metrics_unavailable');else{const result=await planBusinessAds(f.req({mode:'performance'}),deps);assert.equal(result.metrics[0].likes,4);assert.equal(result.metrics[0].comments,2);assert.equal(result.sourceDraftId,f.source.id);}assert.equal(reads,1);assert.equal(f.count(),0);}
});
test('ad planner rejects stale ownership, profile and tokens after AI; concurrent requests share lease',async()=>{
 const{planBusinessAds}=await import('./ad-planning');for(const mutation of['owner','token','profile']as const){const f=await adFixture();let started=0,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);const deps={authorize:f.authorize as never,suggest:async()=>{started++;await gate;return f.strategy;}};const pending=planBusinessAds(f.req(),deps);while(!started)await new Promise(resolve=>setImmediate(resolve));await assert.rejects(planBusinessAds(f.req(),deps),/masih berjalan/);if(mutation==='owner')f.database.values.get(f.ref.path)!.ownerUid='other';if(mutation==='token')f.database.values.get(`${f.ref.path}/private_meta_connections/instagram`)!.encryptedToken='changed';if(mutation==='profile'){const ws=f.database.values.get(f.ref.path)!;const snap=JSON.parse(ws.snapshotJson);snap.brand.businessName='Changed';ws.snapshotJson=JSON.stringify(snap);}release();await assert.rejects(pending);assert.equal(f.database.values.has(`${f.ref.path}/ad_planning_jobs/primary`),false);}
});

test('performance planner reads historical post metrics through original targets, including legacy channel-only receipts',async()=>{
 const{planBusinessAds}=await import('./ad-planning');for(const legacyReceipt of[false,true]){const f=await adFixture();delete(f.source.publishTargets[0]as any).connectionId;delete(f.source.channelStatuses[0]as any).connectionId;const stored=f.database.values.get(`${f.ref.path}/social_drafts/${f.source.id}`)!;stored.draft=f.source;const receipt=f.database.values.get(`${f.ref.path}/publish_jobs/${f.source.id}`)!.receipts[0];receipt.channel='instagram';if(legacyReceipt)delete receipt.connectionId;let reads=0;const result=await planBusinessAds(f.req({mode:'performance'}),{authorize:f.authorize as never,decrypt:()=> 'private-test',graph:(async()=>{reads++;return{like_count:7,comments_count:1};})as never,suggest:async()=>f.strategy});assert.equal(reads,1);assert.equal(result.metrics[0].likes,7);assert.equal(result.sourceDraftId,f.source.id);assert.equal(f.count(),0);}
});
