import test from 'node:test';
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
    generate?: (input: Parameters<typeof generateBrandContentDraft>[0]) => Promise<{ draft: ReturnType<typeof generateBrandContentDraft>; engineMode: 'deterministic_local' }>;
    renderImage?: (params: { businessName: string; title: string; hook: string; cta: string }) => Promise<Buffer>;
  } = {}) => createSocialContent(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, topic: options.topic || 'Promo akhir pekan', format: options.format || 'short_video', ...(options.sourceAssetId ? { sourceAssetId: options.sourceAssetId } : {}) }) }), {
    authorize: authorize as never, storage: storage as never,
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
  const {draft}=await f.create({renderImage:async p=>{assert.equal((p as {aspectRatio?:string}).aspectRatio,'9:16');seen.push(p.title);return Buffer.from(p.title);},renderVideo:async p=>{assert.equal(p.images.length,4);assert.deepEqual(p.images.map(b=>b.toString()),['Langkah 1','Langkah 2','Langkah 3','Langkah 4']);assert.equal(p.sampleRate,24000);return {mp4:Buffer.from('mock-mp4-output'),poster:await sharp({create:{width:720,height:1280,channels:3,background:'#ffffff'}}).jpeg().toBuffer(),width:720,height:1280,durationSeconds:25,mimeType:'video/mp4'};}});
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
test('partial Reels retry sends only the failed channel and unknown delivery blocks resend',async()=>{
  const f=fixture();const{draft}=await f.create();const sends:string[]=[];let retry=false;
  const reelPublisher:NonNullable<NonNullable<Parameters<typeof publishSocialContent>[1]>['reelPublisher']>=async p=>{sends.push(p.channel);if(p.channel==='instagram'&&!retry)throw new MetaRequestError('rejected');return{externalPostId:'confirmed'};};
  const first=await publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher});assert.equal(first.draft.status,'partially_published');retry=true;await publishSocialContent(f.request(draft.id),{...f.dependencies,reelPublisher});assert.deepEqual(sends,['facebook','instagram','instagram']);assert.equal(f.count(),1);
  const unknown=fixture();const other=await unknown.create();let calls=0;const uncertain=async()=>{calls++;throw new MetaRequestError('uncertain',true);};const result=await publishSocialContent(unknown.request(other.draft.id),{...unknown.dependencies,reelPublisher:uncertain});assert.equal(result.draft.status,'needs_attention');assert.equal(unknown.count(),1);await assert.rejects(publishSocialContent(unknown.request(other.draft.id),{...unknown.dependencies,reelPublisher:uncertain}));assert.equal(calls,2);
});
