import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAND_PRESETS, generateBrandContentDraft } from '../veloxa-engine';
import { jsonFingerprint } from '../profile-fingerprint';
import { prepareContentOperation, readContentOperation } from './content-operation';
import { GenerationStageError } from './content-generation-stream';
import { reserveGenerationAttempt } from './generation-policy';
import { ApiError } from './http';
import { studioGenerationCheckpoint } from './studio-generation-checkpoint';
import type { ContentAgentParams } from './content-agent';

/** Serialized transactions exercise continuation claims without Firebase or provider calls. */
class RecoveryDatabase {
  values = new Map<string, Record<string, any>>();
  tail = Promise.resolve();

  collection(path: string) { return new RecoveryCollection(this, path); }

  write(ref: RecoveryDocument, value: Record<string, unknown>, merge: boolean) {
    const previous = merge ? this.values.get(ref.path) ?? {} : {};
    this.values.set(ref.path, { ...structuredClone(previous), ...structuredClone(value) });
  }

  async runTransaction<T>(action: (tx: any) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const writes: Array<() => void> = [];
    const tx = {
      get: (ref: RecoveryDocument) => ref.get(),
      create: (ref: RecoveryDocument, value: Record<string, unknown>) => writes.push(() => {
        assert.equal(this.values.has(ref.path), false);
        this.write(ref, value, false);
      }),
      update: (ref: RecoveryDocument, value: Record<string, unknown>) => writes.push(() => this.write(ref, value, true)),
      set: (ref: RecoveryDocument, value: Record<string, unknown>, options?: { merge?: boolean }) =>
        writes.push(() => this.write(ref, value, options?.merge ?? false)),
    };
    try {
      const result = await action(tx);
      writes.forEach(write => write());
      return result;
    } finally { release(); }
  }
}

class RecoveryCollection {
  constructor(public database: RecoveryDatabase, public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  get parent(): RecoveryDocument | null {
    const parts = this.path.split('/');
    return parts.length > 1 ? new RecoveryDocument(this.database, parts.slice(0, -1).join('/')) : null;
  }
  doc(id: string) { return new RecoveryDocument(this.database, `${this.path}/${id}`); }
  async get() {
    const paths = [...this.database.values.keys()].filter(path => path.startsWith(this.path + '/')
      && !path.slice(this.path.length + 1).includes('/'));
    return { docs: await Promise.all(paths.map(path => new RecoveryDocument(this.database, path).get())) };
  }
  where(key: string, _operator: string, value: unknown) {
    return { limit: (limit: number) => ({ get: async () => ({
      docs: (await this.get()).docs.filter(doc => doc.data()?.[key] === value).slice(0, limit),
    }) }) };
  }
}

class RecoveryDocument {
  constructor(public firestore: RecoveryDatabase, public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  get parent() { return new RecoveryCollection(this.firestore, this.path.split('/').slice(0, -1).join('/')); }
  collection(name: string) { return new RecoveryCollection(this.firestore, `${this.path}/${name}`); }
  async get() {
    const value = this.firestore.values.get(this.path);
    return { id: this.id, exists: !!value, ref: this, data: () => value && structuredClone(value) };
  }
  async update(value: Record<string, unknown>) { this.firestore.write(this, value, true); }
}

function recoveryFixture() {
  const database = new RecoveryDatabase();
  const ref = database.collection('workspaces').doc('studio-recovery');
  database.values.set(ref.path, {
    ownerUid: 'studio-owner', memberUids: [], subscriptionPlanId: 'free_trial',
    snapshotJson: JSON.stringify({ brand: { ...BRAND_PRESETS.cafe_fnb, workspaceId: ref.id } }),
  });
  const operationId = 'f29dde64-f3d7-4257-9d78-acac58c95b7e';
  const body = { operationId, workspaceId: ref.id, businessId: 'primary', format: 'carousel', topic: 'Kenali layanan bisnis' };
  let clock = Date.now();
  const now = () => clock;
  const advance = (milliseconds: number) => { clock += milliseconds; };
  const request = (changes = {}) => new Request('https://veloxa.example/api/veloxa/content', {
    method: 'POST', body: JSON.stringify({ ...body, ...changes }),
  });
  const authorize = async (_request: Request, workspaceId: unknown) => {
    assert.equal(workspaceId, ref.id);
    return { ref, user: { uid: 'studio-owner' }, workspaceId: ref.id, workspace: (await ref.get()).data()! };
  };
  const draft = {
    id: `draft_${operationId}`, workspaceId: ref.id, businessId: 'primary', format: 'carousel',
    title: 'Kenali layanan bisnis', renderedMedia: { url: '/cover.jpg' },
    renderedSlides: Array.from({ length: 5 }, (_, index) => ({ url: `/slide-${index + 1}.jpg` })),
  };
  const jobPath = `${ref.path}/generation_jobs/${operationId}`;
  const usage = () => [...database.values.entries()].filter(([path]) => path.includes('/generation_usage/'));
  return { database, ref, body, operationId, request, now, advance, authorize, draft, jobPath, usage };
}

test('a Studio continuation reserves quota once and saves exactly one complete carousel', async () => {
  const f = recoveryFixture();
  let invocations = 0;
  const create = async (_request: Request, options: any) => {
    invocations++;
    const generationQuota = await reserveGenerationAttempt(f.ref as never, f.ref.id, 'free_trial', options.studioJob);
    options.onProgress({ stage: 'script' });
    if (invocations === 1) throw new GenerationStageError(new ApiError(202, 'Still processing', 'content_agent_pending'), 'script');
    options.onProgress({ stage: 'saving' });
    await options.persistStudioDraft(f.ref.collection('social_drafts').doc(f.draft.id), {
      draft: f.draft, operationId: f.operationId, engineMode: 'openai_live',
    });
    return { draft: f.draft, generationQuota, engineMode: 'openai_live' };
  };
  const deps = { authorize: f.authorize as never, create: create as never, now: f.now };
  const first = await prepareContentOperation(f.request(), deps);
  assert.equal(first.start, true);
  await assert.rejects(first.run(() => {}), { code: 'content_operation_pending' });
  assert.equal(f.database.values.get(f.jobPath)?.state, 'retrying');
  assert.equal(f.usage()[0][1].count, 1);

  f.advance(1_001);
  const continuation = await prepareContentOperation(f.request(), deps);
  assert.equal(continuation.start, true);
  const result = await continuation.run(() => {});
  assert.equal(result.draft.id, f.draft.id);
  assert.equal(f.usage()[0][1].count, 1);
  assert.equal((await f.ref.collection('social_drafts').get()).docs.length, 1);
  assert.equal(f.database.values.get(f.jobPath)?.state, 'complete');
  assert.equal((await prepareContentOperation(f.request(), deps)).start, false);
  assert.equal(invocations, 2);
});

test('concurrent claims and an expired old worker cannot start duplicate Studio work', async () => {
  const f = recoveryFixture();
  let invocations = 0;
  const create = async (_request: Request, options: any) => {
    invocations++;
    await options.persistStudioDraft(f.ref.collection('social_drafts').doc(f.draft.id), {
      draft: f.draft, operationId: f.operationId, engineMode: 'openai_live',
    });
    return { draft: f.draft, engineMode: 'openai_live' };
  };
  const deps = { authorize: f.authorize as never, create: create as never, now: f.now };
  const claims = await Promise.all([prepareContentOperation(f.request(), deps), prepareContentOperation(f.request(), deps)]);
  assert.equal(claims.filter(claim => claim.start).length, 1);
  const oldClaim = claims.find(claim => claim.start)!;
  f.advance(330_001);
  const replacement = await prepareContentOperation(f.request(), deps);
  assert.equal(replacement.start, true);
  await assert.rejects(oldClaim.run(() => {}), { code: 'content_operation_pending' });
  assert.equal(invocations, 0);
  await replacement.run(() => {});
  assert.equal(invocations, 1);
  assert.equal((await f.ref.collection('social_drafts').get()).docs.length, 1);
});

test('a rejected Reels scene automatically continues with the same quota and draft identity', async () => {
  const f = recoveryFixture();
  let calls = 0;
  const create = async (_request: Request, options: any) => {
    calls++;
    const generationQuota = await reserveGenerationAttempt(f.ref as never, f.ref.id, 'free_trial', options.studioJob);
    options.onProgress({ stage: 'compositing' });
    if (calls === 1) throw new GenerationStageError(new ApiError(422, 'Scene needs repair', 'reels_photo_layout_unreadable'), 'compositing');
    await options.persistStudioDraft(f.ref.collection('social_drafts').doc(f.draft.id), { draft: f.draft, operationId: f.operationId, engineMode: 'openai_live' });
    return { draft: f.draft, generationQuota, engineMode: 'openai_live' };
  };
  const deps = { authorize: f.authorize as never, create: create as never, now: f.now };
  const first = await prepareContentOperation(f.request({ format: 'short_video' }), deps);
  await assert.rejects(first.run(() => {}), { code: 'content_operation_pending' });
  assert.equal(f.database.values.get(f.jobPath)?.state, 'retrying');
  f.advance(10_000);
  const next = await prepareContentOperation(f.request({ format: 'short_video' }), deps);
  await next.run(() => {});
  assert.equal(f.usage()[0][1].count, 1);
  assert.equal((await f.ref.collection('social_drafts').get()).docs.length, 1);
});

test('a lost save acknowledgement recovers the persisted draft without another generation', async () => {
  const f = recoveryFixture();
  let invocations = 0;
  const create = async (_request: Request, options: any) => {
    invocations++;
    options.onProgress({ stage: 'saving' });
    await options.persistStudioDraft(f.ref.collection('social_drafts').doc(f.draft.id), {
      draft: f.draft, operationId: f.operationId, engineMode: 'openai_live',
    });
    throw new GenerationStageError(new ApiError(503, 'Save reply lost'), 'saving');
  };
  const deps = { authorize: f.authorize as never, create: create as never, now: f.now };
  const operation = await prepareContentOperation(f.request(), deps);
  await assert.rejects(operation.run(() => {}), { stage: 'saving' });
  const status = await readContentOperation(f.request(), f.ref.id, 'primary', f.operationId, { authorize: f.authorize as never });
  assert.equal(status.state, 'complete');
  assert.equal(status.result?.draft.id, f.draft.id);
  assert.equal((await prepareContentOperation(f.request(), deps)).start, false);
  assert.equal(invocations, 1);

  const { operationId: ignored, ...originalInput } = f.body;
  await assert.rejects(readContentOperation(f.request(), f.ref.id, 'primary', f.operationId, {
    authorize: f.authorize as never,
    expectedInputFingerprint: await jsonFingerprint({ ...originalInput, topic: 'A different topic' }),
  }), { status: 409 });
});

test('a failed carousel image resumes with its saved script and the four successful images', async () => {
  const f = recoveryFixture();
  const job = f.ref.collection('generation_jobs').doc(f.operationId);
  f.database.values.set(job.path, { state: 'running' });
  const files = new Map<string, Buffer>();
  const imageCalls = new Map<string, number>();
  let scriptCalls = 0;
  const bucket = {
    file: (path: string) => ({
      download: async () => {
        const bytes = files.get(path);
        if (!bytes) throw Object.assign(new Error('No cached image'), { code: 404 });
        return [bytes];
      },
      save: async (bytes: Buffer) => { files.set(path, bytes); },
    }),
  };
  const params: ContentAgentParams = {
    brand: { ...BRAND_PRESETS.cafe_fnb, workspaceId: f.ref.id },
    source: 'manual_studio', format: 'carousel', customTopic: 'Layanan bisnis',
    vaultAssets: [], connections: [], planId: 'free_trial',
  };
  const checkpoint = studioGenerationCheckpoint(job as never, async () => {}, value => job.update(value), () => bucket as never, {
    generate: async input => {
      scriptCalls++;
      return { draft: generateBrandContentDraft(input), engineMode: 'deterministic_local' };
    },
    renderImage: async input => {
      const calls = (imageCalls.get(input.title) ?? 0) + 1;
      imageCalls.set(input.title, calls);
      if (input.title === 'Slide 3' && calls === 1) throw new ApiError(502, 'Temporary image failure');
      return Buffer.from(`Completed image ${input.title}`);
    },
  });
  const images = Array.from({ length: 5 }, (_, index) => ({
    businessName: params.brand.businessName, title: `Slide ${index + 1}`, hook: 'Layanan bisnis', cta: '',
  }));

  const originalScript = await checkpoint.generate(params);
  const first = await Promise.allSettled(images.map(image => checkpoint.renderImage(image)));
  assert.equal(first.filter(image => image.status === 'rejected').length, 1);
  assert.equal(files.size, 4);
  assert.deepEqual(await checkpoint.generate(params), JSON.parse(JSON.stringify(originalScript)));
  const recovered = await Promise.all(images.map(image => checkpoint.renderImage(image)));
  assert.equal(recovered.length, 5);
  assert.equal(scriptCalls, 1);
  assert.deepEqual([...imageCalls.entries()], [
    ['Slide 1', 1], ['Slide 2', 1], ['Slide 3', 2], ['Slide 4', 1], ['Slide 5', 1],
  ]);
  assert.equal(files.size, 5);
});

test('another workspace member and a different business cannot read a Studio operation', async () => {
  const f = recoveryFixture();
  await prepareContentOperation(f.request(), { authorize: f.authorize as never, now: f.now });
  f.database.values.get(f.ref.path)!.memberUids = ['another-member'];
  const member = async (request: Request, workspaceId: unknown) => ({
    ...await f.authorize(request, workspaceId), user: { uid: 'another-member' },
  });
  await assert.rejects(readContentOperation(f.request(), f.ref.id, 'primary', f.operationId, {
    authorize: member as never,
  }), { status: 403 });
  await assert.rejects(readContentOperation(f.request(), f.ref.id, 'b_9d30bcda-29a2-4db2-95d8-882790aa68a1', f.operationId, {
    authorize: f.authorize as never,
  }), { status: 409 });
});
