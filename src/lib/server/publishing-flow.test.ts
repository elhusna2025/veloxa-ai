import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createSocialContent } from './content';
import { analyzeBrandLogo } from './brand-palette';
import { loadContentReferences } from './content-references';
import type { ContentAgentParams } from './content-agent';
import { changeWorkspacePhotoState, listWorkspacePhotos, persistWorkspacePhoto, previewWorkspacePhoto } from './brand-assets';
import { publishSocialContent } from './publishing';
import { ApiError } from './http';
import { MetaRequestError } from './meta-graph';
import { BRAND_PRESETS, generateBrandContentDraft } from '../veloxa-engine';

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
      set: (ref: Doc, data: any, options?: { merge?: boolean }) => operations.push(() => this.write(ref, data, options?.merge)),
      update: (ref: Doc, data: any) => operations.push(() => this.write(ref, data)) };
    try { const result = await action(tx); operations.forEach(operation => operation()); return result; }
    finally { release(); }
  }
}
class Collection {
  constructor(public database: Database, public path: string) {}
  doc(id: string) { return new Doc(this.database, `${this.path}/${id}`); }
  limit(count: number) { return { get: async () => ({ docs: (await this.get()).docs.slice(0,count) }) }; }
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
    sourceAssetId?: string;
    referenceAssetIds?: string[];
    referenceInstruction?: string;
    onProgress?: (event: { stage: string }) => void;
    generate?: (input: ContentAgentParams) => Promise<{ draft: ReturnType<typeof generateBrandContentDraft>; engineMode: 'deterministic_local' }>;
    renderImage?: (params: { businessName: string; title: string; hook: string; cta: string; visualDirection?:string; businessContext?:{description:string;audience:string;topic:string}; brandPalette?:string[] }) => Promise<Buffer>;
  } = {}) => createSocialContent(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, topic: options.topic || 'Promo akhir pekan', format: options.format || 'single_post', ...(options.sourceAssetId ? { sourceAssetId: options.sourceAssetId } : {}), ...(options.referenceAssetIds ? { referenceAssetIds: options.referenceAssetIds, referenceInstruction: options.referenceInstruction } : {}) }) }), {
    authorize: authorize as never, storage: storage as never, onProgress: options.onProgress,
    generate: async input => {
      generateCalls++;
      if (options.generate) return options.generate(input);
      const draft = generateBrandContentDraft(input);
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
  const request=new Request('http://localhost/api',{method:'POST',body:JSON.stringify({workspaceId:f.ref.id,topic:'Uji',format:'single_post',developmentUnlimited:true,generationPolicy:{mode:'development',enabled:true}})});
  await assert.rejects(createSocialContent(request,{authorize:f.authorize as never,generate:async()=>{throw Error('Provider must not be called');}}),error=>error instanceof ApiError&&error.status===429);
  assert.equal(f.generationCount(),6);assert.equal(f.generateCalls(),0);
 }
});

test('each no-reference carousel image receives its own exact slide copy and distinct semantic scene',async()=>{
 const f=fixture();const scenes=['Pemilik usaha merencanakan operasional','Kasir mencatat transaksi penjualan','Petugas gudang menghitung persediaan','Tim keuangan meninjau catatan','Tim bisnis berkoordinasi di meja rapat'];let rendered=0;
 await f.create({format:'carousel',generate:async input=>{const draft=generateBrandContentDraft(input);draft.slides=scenes.map((visualDirection,index)=>({slideNumber:index+1,headline:`Pesan ${index+1}`,body:`Penjelasan ${index+1}`,visualDirection,badgeText:`${index+1}/5`}));return{draft,engineMode:'deterministic_local'};},renderImage:async params=>{const index=rendered++;assert.equal(params.title,`Pesan ${index+1}`);assert.equal(params.hook,`Penjelasan ${index+1}`);assert.equal(params.visualDirection,scenes[index]);return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});assert.equal(rendered,5);assert.equal(f.generationCount(),1);
});

test('no-reference single and carousel forward real business context; every carousel scene direction reaches renderer',async()=>{
 for(const format of ['single_post','carousel'] as const){
  const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,businessDescription:'Berez ERP untuk stok dan penjualan',targetAudience:'Pemilik usaha',offerings:[{id:'erp',title:'Sistem pengelolaan usaha',highlight:'Catatan stok',priceLabel:'',category:'service'}]};record.snapshotJson=JSON.stringify(snapshot);
  let seen=0;await f.create({format,topic:'Kenalan dengan Berez ERP',renderImage:async params=>{seen++;assert.match(params.businessContext!.description,/Berez ERP untuk stok dan penjualan/);assert.match(params.businessContext!.description,/Catatan stok/);assert.equal(params.businessContext!.audience,'Pemilik usaha');assert.equal(params.businessContext!.topic,'Kenalan dengan Berez ERP');if(format==='carousel')assert.equal(params.visualDirection,'Visual direction');return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});
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
 await assert.rejects(persistWorkspacePhoto(failingRef as never,f.ref.id,'customer-a',bytes,'Failed photo',storage as never),error=>error instanceof ApiError&&error.status===503&&!error.message.includes('PRIVATE_DATABASE_ERROR'));
 assert.equal(deleted.length,1);assert.equal(deleted[0],writes[1].path);assert.notEqual(deleted[0],writes[0].path);
});
test('ambiguous photo metadata failures preserve bytes and recover confirmed commits',async()=>{
 const f=fixture();let deleted=0;const storage={file:()=>({save:async()=>{},delete:async()=>{deleted++;}})};
 let record:any;
 const committedRef={collection:()=>({doc:()=>({create:async(value:any)=>{record=value;throw Object.assign(new Error('late response'),{code:4});},get:async()=>({exists:true,data:()=>record})})})};
 const result=await persistWorkspacePhoto(committedRef as never,f.ref.id,'customer-a',Buffer.from('fixture'),'Recovered',storage as never);assert.equal(result.id,record.asset.id);assert.equal(deleted,0);
 for(const unreadable of [false,true]){
  const uncertainRef={collection:()=>({doc:()=>({create:async()=>{throw Object.assign(new Error('timeout'),{code:4});},get:async()=>{if(unreadable)throw new Error('network');return{exists:false,data:()=>undefined};}})})};
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
  const {draft}=await f.create({format,referenceAssetIds:ids,referenceInstruction:instruction,generate:async input=>{brief=input.referenceBrief;const draft=generateBrandContentDraft(input);if(format==='carousel')draft.slides=Array.from({length:5},(_,i)=>({slideNumber:i+1,headline:'Slide '+i,body:'Penjelasan',visualDirection:'Ruang rapat',badgeText:''}));return{draft,engineMode:'deterministic_local'};},renderImage:async input=>{seen.push(input);return sharp({create:{width:1080,height:1350,channels:3,background:'#fff'}}).jpeg().toBuffer();}});
  assert.equal(seen.length,format==='carousel'?5:1);for(const input of seen){assert.equal(input.referenceImages.length,count);assert.equal(input.referenceInstruction,instruction);assert.deepEqual(input.referenceImages,ids.map(id=>f.blobs.get(`workspaces/${f.ref.id}/vault/${id}.jpg`)));}
  assert.deepEqual(brief,{titles:ids.map((_,index)=>`Reference ${index+1}`),instruction});assert.deepEqual(draft.usedRealAssetIds,ids);assert.equal(draft.referenceInstruction,instruction);assert.equal(f.generationCount(),1);
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
    assert.deepEqual(stages, ['validation', 'script', 'images', 'saving']);
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

test('carousel generation renders and stores five ordered slides while consuming one generation quota', async () => {
  const f = fixture();
  const workspace = (await f.ref.get()).data()!;
  const snapshot = JSON.parse(workspace.snapshotJson);
  snapshot.brand.defaultCta = '';
  f.database.write(f.ref, { snapshotJson: JSON.stringify(snapshot) });
  const rendered: { title: string; hook: string; cta: string }[] = [];
  const result = await f.create({
    format: 'carousel',
    renderImage: async params => {
      rendered.push({ title: params.title, hook: params.hook, cta: params.cta });
      return sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    },
  });
  const record = f.database.values.get(`${f.ref.path}/social_drafts/${result.draft.id}`)!;
  assert.equal(rendered.length, 5);
  assert.deepEqual(rendered.map(item => item.title), Array.from({ length: 5 }, (_, index) => `Headline ${index + 1}`));
  assert.deepEqual(rendered.map(item => item.hook), Array.from({ length: 5 }, (_, index) => `Body ${index + 1}`));
  assert.deepEqual(rendered.slice(0, 4).map(item => item.cta), Array.from({ length: 4 }, (_, index) => `${index + 1}/5 · Geser untuk lanjut`));
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
