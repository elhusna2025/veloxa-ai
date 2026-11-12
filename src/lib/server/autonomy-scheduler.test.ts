import assert from 'node:assert/strict';
import test from 'node:test';
import { runAutonomySchedulerTick } from './autonomy-scheduler';

type Fields = Record<string, any>;
const HEARTBEAT = 'system_operations/organic_scheduler';

class SchedulerDatabase {
  records = new Map<string, Fields>();
  tail = Promise.resolve();
  pages = 0;
  advanceOnRead?: () => void;
  failNextRead = false;
  collection(name: string) { return new Collection(this, name); }
  async getAll(...refs: Document[]) { return Promise.all(refs.map(ref => ref.get())); }
  async runTransaction<T>(fn: (tx: {
    get: (ref: Document) => Promise<Snapshot>;
    set: (ref: Document, fields: Fields) => void;
    update: (ref: Document, fields: Fields) => void;
  }) => Promise<T>) {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const writes: (() => void)[] = [];
    const merge = (ref: Document, fields: Fields) => writes.push(() => {
      this.records.set(ref.path, { ...this.records.get(ref.path), ...structuredClone(fields) });
    });
    try {
      const result = await fn({ get: ref => ref.get(), set: merge, update: merge });
      for (const write of writes) write();
      return result;
    } finally {
      release();
    }
  }
}

class Document {
  constructor(public db: SchedulerDatabase, public path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  get parent() { return new Collection(this.db, this.path.slice(0, this.path.lastIndexOf('/'))); }
  collection(name: string) { return new Collection(this.db, this.path + '/' + name); }
  async get() { return new Snapshot(this, this.db.records.get(this.path)); }
}

class Snapshot {
  constructor(public ref: Document, private value: Fields | undefined) {}
  get id() { return this.ref.id; }
  data() { return this.value; }
  get(key: string) { return this.value?.[key]; }
}

class Collection {
  constructor(public db: SchedulerDatabase, public path: string) {}
  get parent() { return new Document(this.db, this.path.slice(0, this.path.lastIndexOf('/'))); }
  doc(id: string) { return new Document(this.db, this.path + '/' + id); }
  where(key: string, operator: string, value: unknown) {
    assert.deepEqual([key, operator, value], ['enabled', '==', true]);
    return new Query(this);
  }
}

function compare(a: { due: number; id: string }, b: { due: number; id: string }) {
  return a.due - b.due || a.id.localeCompare(b.id);
}

class Query {
  constructor(
    private collection: Collection,
    private now = Number.POSITIVE_INFINITY,
    private cap = 0,
    private after?: { due: number; id: string },
  ) {}
  where(key: string, operator: string, now: number) {
    assert.deepEqual([key, operator], ['nextDueMs', '<=']);
    return new Query(this.collection, now, this.cap, this.after);
  }
  orderBy() { return this; }
  startAfter(snapshotOrDue: Snapshot | number, id?: string) {
    const after = typeof snapshotOrDue === 'number'
      ? { due: snapshotOrDue, id: id! } : { due: snapshotOrDue.get('nextDueMs'), id: snapshotOrDue.id };
    return new Query(this.collection, this.now, this.cap, after);
  }
  limit(cap: number) { return new Query(this.collection, this.now, cap, this.after); }
  async get() {
    const { db, path } = this.collection;
    db.pages++;
    db.advanceOnRead?.();
    if (db.failNextRead) {
      db.failNextRead = false;
      throw new Error('temporary Firestore outage');
    }
    const rows = [...db.records].flatMap(([key, fields]) => {
      const id = key.slice(path.length + 1);
      if (!key.startsWith(path + '/') || id.includes('/') || !fields.enabled || fields.nextDueMs > this.now) return [];
      return [{ due: fields.nextDueMs as number, id, fields }];
    }).sort(compare);
    const docs = rows.filter(row => !this.after || compare(row, this.after) > 0)
      .slice(0, this.cap).map(row => new Snapshot(this.collection.doc(row.id), row.fields));
    return { docs };
  }
}

function schedule(db: SchedulerDatabase, id: string, workspaceId: string, due: number, format = 'single_post', extra: Fields = {}) {
  db.records.set('auto_content_rules/' + id, {
    enabled: true, workspaceId, nextDueMs: due, config: { formats: [format] }, sequence: 0, ...extra,
  });
}

const noReconciliation = async () => 0;

test('24 simultaneous workspaces drain in bounded oldest-first batches, with no duplicate processing across overlapping ticks', async () => {
  const db = new SchedulerDatabase();
  const now = 100_000;
  for (let i = 23; i >= 0; i--) schedule(db, 'rule-' + i.toString().padStart(2, '0'), 'workspace-' + i, now - 60_000);
  const processed: string[] = [];
  let active = 0;
  let peak = 0;
  let releaseFirst!: () => void;
  let firstBatchReady!: () => void;
  const firstBatch = new Promise<void>(resolve => { firstBatchReady = resolve; });
  const firstBatchGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const tick = () => runAutonomySchedulerTick({
    db: db as never, now: () => now, reconcile: noReconciliation,
    process: async ref => {
      processed.push(ref.id);
      active++;
      peak = Math.max(peak, active);
      if (processed.length === 6) firstBatchReady();
      if (processed.length <= 6) await firstBatchGate;
      else await new Promise<void>(resolve => setImmediate(resolve));
      db.records.get(ref.path)!.enabled = false;
      active--;
      return { state: 'published' };
    },
  });
  const first = tick();
  await firstBatch;
  assert.deepEqual(await tick(), { state: 'busy', processed: 0, reconciled: 0 });
  releaseFirst();
  assert.equal((await first).processed, 6);
  for (let batch = 0; batch < 3; batch++) assert.equal((await tick()).processed, 6);
  assert.equal(peak, 6);
  assert.deepEqual(processed, Array.from({ length: 24 }, (_, i) => 'rule-' + i.toString().padStart(2, '0')));
  const heartbeat = db.records.get(HEARTBEAT)!;
  assert.equal(heartbeat.completedAt, now);
  assert.equal(heartbeat.lastBatch.oldestDueLagMs, 60_000);
  assert.deepEqual(heartbeat.lastBatch.outcomes, { published: 6 });
  assert.equal((await tick()).state, 'idle');
});

test('only two Reels start together, dense workspace rows do not hide others, and a dispatch guard leaves other businesses intact', async () => {
  const db = new SchedulerDatabase();
  const now = 80_000;
  for (let i = 0; i < 25; i++) schedule(db, 'rule-a-' + i.toString().padStart(2, '0'), 'shared', now - 300, 'short_video');
  schedule(db, 'rule-b', 'blocked', now - 200);
  schedule(db, 'rule-c', 'other', now - 100, 'short_video');
  schedule(db, 'rule-d', 'another', now);
  const blockedGuard = 'workspaces/blocked/server_operation_guards/organic_dispatch';
  db.records.set(blockedGuard, { leaseId: 'uncertain' });
  const started: string[] = [];
  const run = (reconcile = noReconciliation) => runAutonomySchedulerTick({
    db: db as never, now: () => now, reconcile,
    process: async ref => {
      started.push(ref.id);
      db.records.get(ref.path)!.enabled = false;
      return { state: 'published' };
    },
  });
  assert.equal((await run()).processed, 2);
  assert.deepEqual(started, ['rule-a-00', 'rule-c']);
  assert.ok(db.pages > 1);
  assert.equal(db.records.get('auto_content_rules/rule-b')!.enabled, true);
  assert.equal(db.records.get(HEARTBEAT)!.lastBatch.blockedByDispatch, 1);
  assert.equal((await run(async () => {
    db.records.delete(blockedGuard);
    return 1;
  })).reconciled, 1);
  assert.deepEqual(started.slice(2), ['rule-a-01', 'rule-b', 'rule-d']);
});

test('a bounded scan resumes beyond many stranded workspaces even when all due times are identical', async () => {
  const db = new SchedulerDatabase();
  const now = 80_000;
  for (let i = 0; i < 99; i++) schedule(db, 'blocked-' + i.toString().padStart(2, '0'), 'blocked', now);
  db.records.set('workspaces/blocked/server_operation_guards/organic_dispatch', { leaseId: 'uncertain' });
  schedule(db, 'eligible', 'eligible', now);
  const called: string[] = [];
  const run = () => runAutonomySchedulerTick({
    db: db as never, now: () => now, reconcile: noReconciliation,
    process: async ref => { called.push(ref.id); return { state: 'published' }; },
  });
  assert.equal((await run()).processed, 0);
  assert.equal(db.records.get(HEARTBEAT)!.lastBatch.scanLimitReached, true);
  assert.equal((await run()).processed, 1);
  assert.deepEqual(called, ['eligible']);
  assert.equal(db.records.get(HEARTBEAT)!.scanAfter, null);
});

test('a failed scheduler read releases the lease; a late read starts no work; reconciler failure does not starve due rules', async () => {
  const db = new SchedulerDatabase();
  let now = 100_000;
  schedule(db, 'rule', 'workspace', now);
  let calls = 0;
  const run = () => runAutonomySchedulerTick({
    db: db as never, now: () => now,
    reconcile: async () => { throw new Error('Meta unavailable'); },
    process: async () => { calls++; return { state: 'published' }; },
  });
  db.failNextRead = true;
  await assert.rejects(run(), /temporary Firestore outage/);
  assert.equal(db.records.get(HEARTBEAT)!.tickLeaseUntil, 0);
  assert.equal(db.records.get(HEARTBEAT)!.completedAt, undefined);
  db.advanceOnRead = () => { now += 26_000; };
  assert.equal((await run()).state, 'deferred');
  assert.equal(calls, 0);
  db.advanceOnRead = undefined;
  assert.equal((await run()).state, 'published');
  assert.equal(calls, 1);
  assert.equal(db.records.get(HEARTBEAT)!.lastBatch.reconciliationFailed, true);
});
