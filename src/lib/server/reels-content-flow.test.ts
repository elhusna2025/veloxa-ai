import test from 'node:test';
import { profileFingerprint } from '../profile-fingerprint';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createSocialContent } from './content';
import { publishSocialContent } from './publishing';
import { ApiError } from './http';
import { MetaRequestError } from './meta-graph';
import type { publishMetaReel } from './meta-reels';
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
  for (const channel of ['facebook', 'instagram']) database.values.set(`${ref.path}/private_meta_connections/${channel}`, { channel, accountId: channel === 'facebook' ? '100' : '200', pageId: '100', accountName: 'Test account', handle: '@test', ['encryptedToken']: 'test-ciphertext', expiresAt: Date.now() + 60_000 });
  const blobs = new Map<string, Buffer>();
  const storage = { name: 'test-bucket', file: (key: string) => ({ save: async (bytes: Buffer) => { blobs.set(key, bytes); }, download: async () => { const value = blobs.get(key); if (!value) throw new Error('missing media'); return [value]; } }) };
  const authorize = async (_request: Request, workspaceId: unknown) => {
    if (workspaceId !== ref.id) throw new ApiError(403, 'Forbidden workspace');
    return { ref, user: { uid: 'customer-a' }, workspaceId: ref.id, workspace: (await ref.get()).data()! };
  };
  let renderCalls = 0;
  let generateCalls = 0;
  const create = async (options: {
    format?: 'single_post' | 'carousel' | 'short_video';
    generateVoice?: NonNullable<Parameters<typeof createSocialContent>[1]>['generateVoice'];
    renderVideo?: NonNullable<Parameters<typeof createSocialContent>[1]>['renderVideo'];
    topic?: string;
    sourceAssetId?: string;
    referenceAssetIds?: string[];
    referenceInstruction?: string;
    referenceRoles?:import('../content-reference-roles').ContentReferenceRoles;
    onProgress?: (event: { stage: string }) => void;
    generate?: (input: Parameters<typeof generateBrandContentDraft>[0]) => Promise<{ draft: ReturnType<typeof generateBrandContentDraft>; engineMode: 'deterministic_local' }>;
    renderImage?: (params: { businessName: string; title: string; hook: string; cta: string; visualDirection?:string; businessContext?:import('../content-business-context').VisualBusinessContext; brandPalette?:string[] }) => Promise<Buffer>;
  } = {}) => createSocialContent(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, referenceRoles:options.referenceRoles, expectedProfileFingerprint: await profileFingerprint(JSON.parse(database.values.get(ref.path)!.snapshotJson).brand), topic: options.topic || 'Promo akhir pekan', format: options.format || 'short_video', ...(options.sourceAssetId ? { sourceAssetId: options.sourceAssetId } : {}), ...(options.referenceAssetIds ? { referenceAssetIds: options.referenceAssetIds, referenceInstruction: options.referenceInstruction } : {}) }) }), {
    authorize: authorize as never, storage: storage as never, onProgress: options.onProgress,
    generate: async input => {
      generateCalls++;
      if (options.generate) return options.generate(input);
      const draft = generateBrandContentDraft(input);
      if (input.format === 'carousel') draft.slides = Array.from({ length: 5 }, (_, index) => ({ slideNumber: index + 1, headline: `Headline ${index + 1}`, body: `Body ${index + 1}`, visualDirection: 'Visual direction', badgeText: `${index + 1}/5` }));
      if (input.format === 'short_video') {
        draft.videoScenes = Array.from({ length: 4 }, (_, index) => ({ sceneNumber: index + 1, timeRange: `${index * 5}:00`, visualDirection: `Adegan pelajar ${index + 1}`, voiceover: 'Mulai dari satu topik, kerjakan latihan, lalu pahami kesalahan sebelum mencoba lagi.', textOverlay: `Langkah ${index + 1}` }));
        draft.targetChannels = ['facebook', 'instagram'];
        draft.channelStatuses = draft.channelStatuses.filter(item => item.channel === 'facebook' || item.channel === 'instagram');
      }
      return { draft, engineMode: 'deterministic_local' };
    },
    generateVoice: options.generateVoice || (async script => ({ pcm: Buffer.alloc(20 * 48000), sampleRate: 24000 as const, transcript: script, model: 'gpt-realtime-2.1-mini' as const })),
    renderVideo: options.renderVideo || (async () => ({ mp4: Buffer.from('mock-mp4-output'), poster: await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#ffffff' } }).jpeg().toBuffer(), width: 720 as const, height: 1280 as const, durationSeconds: 25, mimeType: 'video/mp4' as const })),
    renderImage: options.renderImage || (async () => {
      renderCalls++;
      return sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    }),
  });
  const dependencies = { authorize: authorize as never, database: database as never, storage: storage as never, decrypt: (_value: string, workspaceId: string) => { assert.equal(workspaceId, ref.id); return 'test-token'; } };
  const request = (draftId: string) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, draftId }) });
  const count = () => [...database.values.entries()].find(([key]) => key.includes('/publish_usage/'))?.[1].count || 0;
  const generationCount = () => [...database.values.entries()].find(([key]) => key.includes('/generation_usage/'))?.[1].count || 0;
  return { database, ref, blobs, create, dependencies, request, count, generationCount, generateCalls: () => generateCalls, renderCalls: () => renderCalls };
}

test('all visual copy is preflighted before any paid image or voice request, including the last slide',async()=>{
 for(const format of ['single_post','carousel','short_video'] as const){
  const f=fixture();let images=0,voices=0;
  await assert.rejects(f.create({format,generate:async input=>{
   const draft=generateBrandContentDraft(input);draft.title='Kenali bisnis Anda';draft.hook='Informasi bisnis yang jelas.';
   const overflow='Informasi penting 123 '.repeat(20);
   if(format==='single_post')draft.hook=overflow;
   if(format==='carousel')draft.slides=Array.from({length:5},(_,index)=>({slideNumber:index+1,headline:`Slide ${index+1}`,body:index===4?overflow:'Informasi bisnis.',visualDirection:'Adegan bisnis',badgeText:`${index+1}/5`}));
   if(format==='short_video')draft.videoScenes=Array.from({length:4},(_,index)=>({sceneNumber:index+1,timeRange:'00:00–00:05',visualDirection:'Adegan bisnis',voiceover:'Informasi bisnis yang jelas.',textOverlay:index===3?overflow:`Langkah ${index+1}`}));
   return {draft,engineMode:'deterministic_local'};
  },renderImage:async()=>{images++;throw new Error('paid image must not start');},generateVoice:async()=>{voices++;throw new Error('paid voice must not start');}}),(error:any)=>error.stage==='compositing'&&error.code==='visual_composition_invalid');
  assert.equal(images,0);assert.equal(voices,0);assert.equal([...f.database.values.keys()].filter(key=>key.includes('/social_drafts/')).length,0);
 }
});

test('visual preflight does not treat detailed captions or Reels voiceover as printed feed body',async()=>{
 for(const format of ['single_post','short_video'] as const){
  const f=fixture();let images=0;
  const{draft}=await f.create({format,generate:async input=>{
   const draft=generateBrandContentDraft(input);draft.title='Kenali bisnis Anda';draft.hook='Informasi bisnis yang jelas.';draft.caption='Penjelasan rinci untuk pembaca. '.repeat(40);
   if(format==='short_video')draft.videoScenes=Array.from({length:4},(_,index)=>({sceneNumber:index+1,timeRange:'00:00–00:05',visualDirection:'Adegan bisnis',voiceover:'Narasi panjang yang tetap berada di audio. '.repeat(8),textOverlay:`Langkah ${index+1}`}));
   return {draft,engineMode:'deterministic_local'};
  },renderImage:async()=>{images++;return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});
  assert.equal(images,format==='short_video'?4:1);assert.ok(draft.caption.includes('Penjelasan rinci untuk pembaca.'));if(format==='short_video')assert.equal(draft.videoScenes?.[3].textOverlay,'Langkah 4');
 }
});

test('every Reels scene receives complete product context and publisher rejects prohibited narration despite forged quality',async()=>{
 const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,businessDescription:'D'.repeat(2000),websiteUrl:'https://business.example.test',offerings:Array.from({length:7},(_,i)=>({id:`p${i}`,title:`Produk ${i}`,highlight:`DETAIL_${i}`,priceLabel:'',category:'service'})),forbiddenWords:['termurah']};record.snapshotJson=JSON.stringify(snapshot);let calls=0;
 const {draft}=await f.create({renderImage:async input=>{calls++;assert.deepEqual(input.businessContext!.offerings,snapshot.brand.offerings);assert.equal(input.businessContext!.description,snapshot.brand.businessDescription);assert.equal(input.businessContext!.websiteUrl,snapshot.brand.websiteUrl);return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});assert.equal(calls,4);
 const stored=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;stored.draft.videoScenes[0].voiceover='Solusi termurah';stored.draft.qualityReview.passed=true;
 let sent=0;await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher:async()=>{sent++;return{externalPostId:'should-not-send'};}}),error=>error instanceof ApiError&&error.code==='content_policy_violation');assert.equal(sent,0);assert.equal(f.count(),0);
});

test('development policy permits Reels after six daily attempts without changing publish usage',async()=>{
 const f=fixture();const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 f.database.values.set(`${f.ref.path}/generation_usage/${day}`,{count:6});f.database.values.set(`platform_configs/generation_${f.ref.id}`,{workspaceId:f.ref.id,mode:'development',enabled:true});
 const bytes=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();const result=await f.create({renderImage:async()=>bytes});
 assert.equal(result.draft.videoScenes?.length,4);assert.equal(result.generationQuota.mode,'development');assert.equal(result.generationQuota.dailyLimit,null);assert.equal(f.generationCount(),7);assert.equal(f.count(),0);assert.equal(f.generateCalls(),1);
});

test('Reels sends selected references into all four scene image calls and retains source ids',async()=>{
 for(const count of [2,4,5,6]){
 const f=fixture();const ids=Array.from({length:count},(_,index)=>'123e4567-e89b-42d3-a456-42661417400'+index);const bytes=await sharp({create:{width:80,height:80,channels:3,background:'#abcdef'}}).jpeg().toBuffer();
 for(const id of ids){const storagePath=`workspaces/${f.ref.id}/vault/${id}.jpg`;f.database.values.set(`${f.ref.path}/server_assets/${id}`,{asset:{id,workspaceId:f.ref.id,title:'Reference',mediaType:'photo'},storagePath});f.blobs.set(storagePath,bytes);}
 const seen:any[]=[];const{draft}=await f.create({referenceAssetIds:ids,referenceInstruction:'Presentasi ERP di ruang rapat.',renderImage:async input=>{seen.push(input);return bytes;}});
 assert.equal(seen.length,4);for(const input of seen){assert.equal(input.aspectRatio,'9:16');assert.deepEqual(input.referenceImages,ids.map(()=>bytes));assert.equal(input.referenceInstruction,'Presentasi ERP di ruang rapat.');}
 assert.deepEqual(draft.usedRealAssetIds,ids);assert.ok(draft.renderedVideo?.url);assert.equal(f.generationCount(),1);
 }
});

test('no-reference Reels forwards business description and scene directions to all four images',async()=>{
 const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,businessDescription:'Sistem ERP pengelolaan stok',targetAudience:'Pemilik bisnis'};record.snapshotJson=JSON.stringify(snapshot);
 let seen=0;await f.create({topic:'Stok usaha yang rapi',renderImage:async params=>{seen++;assert.match(params.businessContext!.description,/Sistem ERP pengelolaan stok/);assert.equal(params.businessContext!.topic,'Stok usaha yang rapi');assert.equal(params.businessContext!.audience,'Pemilik bisnis');assert.match(params.visualDirection!,/Adegan pelajar/);return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});assert.equal(seen,4);assert.equal(f.generationCount(),1);
});

test('saved DNA reaches all four Reels scene render calls without changing voice settings',async()=>{
 const f=fixture();const record=f.database.values.get(f.ref.path)!;const snapshot=JSON.parse(record.snapshotJson);snapshot.brand={...snapshot.brand,useBrandPalette:true,primaryColorHex:'#167D8D',accentColorHex:'#FCAB20'};record.snapshotJson=JSON.stringify(snapshot);
 let seen=0;await f.create({renderImage:async params=>{seen++;assert.deepEqual(params.brandPalette,['#167D8D','#FCAB20']);return sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();}});assert.equal(seen,4);assert.equal(f.generationCount(),1);
});

test('protected roles are applied to all four Reels images without entering image-edit references',async()=>{
 const f=fixture();const ids=Array.from({length:3},(_,i)=>`123e4567-e89b-42d3-a456-42661417400${i}`);
 for(const [index,id] of ids.entries()){const bytes=await sharp({create:{width:80,height:60,channels:3,background:['#cc3344','#2277aa','#aabbcc'][index]}}).jpeg().toBuffer();const storagePath=`workspaces/${f.ref.id}/vault/${id}.jpg`;f.database.values.set(`${f.ref.path}/server_assets/${id}`,{asset:{id,workspaceId:f.ref.id,title:`Ref ${index+1}`,mediaType:'photo'},storagePath});f.blobs.set(storagePath,bytes);}
 let images=0;const roles={[ids[0]]:'visual',[ids[1]]:'screenshot',[ids[2]]:'logo'} as const;
 const {draft}=await f.create({referenceAssetIds:ids,referenceRoles:roles,renderImage:async(input:any)=>{images++;assert.equal(input.sceneOnly,true);assert.equal(input.referenceImages.length,1);assert.deepEqual(input.referenceImages[0],f.blobs.get(`workspaces/${f.ref.id}/vault/${ids[0]}.jpg`));return sharp({create:{width:720,height:1280,channels:3,background:'white'}}).jpeg().toBuffer();}});
 assert.equal(images,4);assert.deepEqual(draft.referenceRoles,roles);assert.equal(draft.renderedVideo?.width,720);assert.equal(f.generationCount(),1);
});

test('Reels reports actual media/render/save stages and distinguishes failed voice from failed images', async () => {
  const f = fixture(); const stages: string[] = [];
  await f.create({ onProgress: event => stages.push(event.stage) });
  assert.deepEqual(stages, ['validation', 'script', 'media', 'compositing', 'rendering', 'saving']);
  for (const stage of ['voiceover', 'images', 'rendering']) {
    const failed = fixture();
    const fail = async () => { throw new Error('PRIVATE_REELS_DETAILS'); };
    await assert.rejects(failed.create(stage === 'voiceover' ? { generateVoice: fail } : stage === 'images' ? { renderImage: fail } : { renderVideo: fail }), (error: any) => error.stage === stage && !error.message.includes('PRIVATE_REELS_DETAILS'));
    assert.equal(failed.generationCount(), 1);
    assert.equal([...failed.database.values.keys()].some(key => key.includes('/social_drafts/')), false);
  }
});

test('switching Instagram login provider forces a new draft before publication quota or dispatch', async () => {
  const f = fixture(); const { draft } = await f.create();
  const key = `${f.ref.path}/private_meta_connections/instagram`;
  const connection = f.database.values.get(key)!;
  f.database.values.set(key, { ...connection, loginProvider: 'instagram' });
  let sent = 0;
  await assert.rejects(publishSocialContent(f.request(draft.id), { ...f.dependencies, reelPublisher: async () => { sent++; return { externalPostId: '900' }; } }), (error: unknown) => error instanceof ApiError && error.code === 'target_changed');
  assert.equal(sent, 0); assert.equal(f.count(), 0);
});

test('Reels generation stores real video metadata and private MP4 path, then publishes once to both bound accounts', async () => {
  const f=fixture();const seen:string[]=[];
  const {draft}=await f.create({renderImage:async p=>{assert.equal((p as {aspectRatio?:string}).aspectRatio,'9:16');seen.push(p.title);return sharp({create:{width:720,height:1280,channels:3,background:'#d0e0f0'}}).jpeg().toBuffer();},renderVideo:async p=>{assert.equal(p.images.length,4);for(const image of p.images){const meta=await sharp(image).metadata();assert.equal(meta.width,720);assert.equal(meta.height,1280);}assert.deepEqual(seen,['Langkah 1','Langkah 2','Langkah 3','Langkah 4']);assert.equal(p.sampleRate,24000);return {mp4:Buffer.from('mock-mp4-output'),poster:await sharp({create:{width:720,height:1280,channels:3,background:'#ffffff'}}).jpeg().toBuffer(),width:720,height:1280,durationSeconds:25,mimeType:'video/mp4'};}});
  const record=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;
  assert.equal(draft.format,'short_video');assert.equal(draft.renderedVideo?.durationSeconds,25);assert.equal(draft.renderedVideo?.width,720);assert.match(draft.caption,/Voiceover menggunakan suara AI\./);assert.equal(seen.length,4);assert.equal(f.generationCount(),1);assert.equal(f.blobs.size,2);assert.match(record.videoStoragePath,/^workspaces\/workspace-a\/renders\/.+\.mp4$/);assert.equal('videoStoragePath' in draft,false);
  const sends:string[]=[];const reelPublisher=async(p:Parameters<typeof publishMetaReel>[0])=>{sends.push(p.channel);assert.deepEqual(p.videoBytes,Buffer.from('mock-mp4-output'));assert.equal(p.videoUrl,draft.renderedVideo!.url);assert.equal(p.accountId,p.channel==='facebook'?'100':'200');return{externalPostId:`remote-${p.channel}`};};
  const result=await publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher});assert.equal(result.draft.status,'published');assert.equal(f.count(),1);
  await publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher});assert.deepEqual(sends,['facebook','instagram']);assert.equal(f.count(),1);
});
test('Reels refuses source assets before generation cost and keeps failed media out of authoritative drafts',async()=>{
  const invalid=fixture();await assert.rejects(invalid.create({sourceAssetId:'123e4567-e89b-42d3-a456-426614174000'}));assert.equal(invalid.generationCount(),0);
  for(const failure of ['voice','image','render']){
    const f=fixture();let imagesFinished=0;
    await assert.rejects(f.create({renderImage:async()=>{await new Promise(r=>setTimeout(r,5));imagesFinished++;if(failure==='image'&&imagesFinished===1)throw new Error('image failed');return Buffer.from('image');},...(failure==='voice'?{generateVoice:async()=>{throw new Error('voice failed');}}:{}),...(failure==='render'?{renderVideo:async()=>{throw new Error('render failed');}}:{})}));
    assert.equal(imagesFinished,4);assert.equal([...f.database.values.keys()].filter(p=>p.includes('/social_drafts/')).length,0);
  }
});
test('missing and foreign MP4 paths or invalid video dimensions cannot reserve quota or dispatch',async()=>{
  for(const mode of ['missing','foreign','dimensions']){
    const f=fixture();const{draft}=await f.create();const record=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;
    if(mode==='missing')delete record.videoStoragePath;if(mode==='foreign')record.videoStoragePath='workspaces/another/renders/video.mp4';if(mode==='dimensions')record.draft.renderedVideo.width=1080;
    let calls=0;await assert.rejects(publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher:async()=>{calls++;return{externalPostId:'unexpected'};}}));assert.equal(calls,0);assert.equal(f.count(),0);
  }
});
test('Reels publication accepts35/59.9/60s and rejects over60 before quota or provider dispatch',async()=>{for(const seconds of[35,59.9,60,60.01]){const f=fixture();const{draft}=await f.create();const stored=f.database.values.get(`${f.ref.path}/social_drafts/${draft.id}`)!;stored.draft.renderedVideo.durationSeconds=seconds;stored.draft.videoDurationSeconds=seconds;let calls=0;const publish=()=>publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher:async()=>{calls++;return{externalPostId:'confirmed'};}});if(seconds>60){await assert.rejects(publish());assert.equal(calls,0);assert.equal(f.count(),0);}else{const result=await publish();assert.equal(result.draft.status,'published');assert.equal(calls,2);assert.equal(f.count(),1);}}});

test('partial Reels retry sends only the failed channel and unknown delivery blocks resend',async()=>{
  const f=fixture();const{draft}=await f.create();const sends:string[]=[];let retry=false;
  const reelPublisher:NonNullable<NonNullable<Parameters<typeof publishSocialContent>[1]>['reelPublisher']>=async p=>{sends.push(p.channel);if(p.channel==='instagram'&&!retry)throw new MetaRequestError('rejected');return{externalPostId:'confirmed'};};
  const first=await publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher});assert.equal(first.draft.status,'partially_published');retry=true;await publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher});assert.deepEqual(sends,['facebook','instagram','instagram']);assert.equal(f.count(),1);
  const unknown=fixture();const other=await unknown.create();let calls=0;const uncertain=async()=>{calls++;throw new MetaRequestError('uncertain',true);};const result=await publishSocialContent(unknown.request(other.draft.id),{...unknown.dependencies,reelPublisher:uncertain});assert.equal(result.draft.status,'needs_attention');assert.equal(unknown.count(),1);await assert.rejects(publishSocialContent(unknown.request(other.draft.id),{...unknown.dependencies,reelPublisher:uncertain}));assert.equal(calls,2);
});
