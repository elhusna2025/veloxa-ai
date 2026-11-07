import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialContent } from './content';
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
  const create = async () => createSocialContent(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, topic: 'Promo akhir pekan', format: 'single_post' }) }), {
    authorize: authorize as never, storage: storage as never,
    generate: async input => ({ draft: generateBrandContentDraft(input), engineMode: 'deterministic_local' }),
  });
  const dependencies = { authorize: authorize as never, database: database as never, storage: storage as never, decrypt: (_value: string, workspaceId: string) => { assert.equal(workspaceId, ref.id); return 'test-token'; } };
  const request = (draftId: string) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ workspaceId: ref.id, draftId }) });
  const count = () => [...database.values.entries()].find(([key]) => key.includes('/publish_usage/'))?.[1].count || 0;
  return { database, ref, blobs, create, dependencies, request, count };
}

test('create real JPEG -> save authoritative draft -> publish both channels -> retry without duplicates', async () => {
  const f = fixture(); const { draft } = await f.create();
  assert.equal(draft.status, 'approved'); assert.equal(f.blobs.size, 1);
  assert.deepEqual(draft.targetChannels, ['facebook', 'instagram']);
  const calls: string[] = [];
  const publisher = async (input: any) => { calls.push(input.channel); assert.ok(input.imageBytes.length > 0); return { externalPostId: `remote-${input.channel}`, permalink: `https://example.test/${input.channel}` }; };
  const result = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  assert.equal(result.draft.status, 'published'); assert.equal(f.count(), 1);
  const again = await publishSocialContent(f.request(draft.id), { ...f.dependencies, publisher });
  assert.equal(again.draft.status, 'published'); assert.deepEqual(calls, ['facebook', 'instagram']); assert.equal(f.count(), 1);
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
