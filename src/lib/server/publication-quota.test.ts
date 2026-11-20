import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { assertPublicationCapacity, incrementPublicationUsage, readPublicationQuota, releasePublicationUsage } from './publication-quota';
import { readWorkspaceBilling } from './billing';

const at = new Date('2026-11-20T05:00:00Z');

function fixture(quota: Record<string, unknown> = {}, monthly: unknown = 29, daily: unknown = 3) {
  const values = new Map<string, Record<string, unknown>>([
    ['private_admin_settings/global', { plans: { free_trial: { dailyDraftLimit: 8, monthlyPublicationLimit: 30, dailyPublicationLimit: 4 } } }],
    ['private_admin_settings/workspace_target', { quota }],
    ['workspaces/target', { quotaUsed: monthly }],
    ['workspaces/target/publish_usage/2026-11', { count: monthly }],
    ['workspaces/target/publish_daily_usage/2026-11-20', { count: daily }],
  ]);
  const writes: string[] = [];
  const doc = (path: string): any => ({
    path, id: path.split('/').at(-1), firestore: database,
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({ data: () => values.get(path) }),
  });
  const collection = (path: string): any => ({
    doc: (id: string) => doc(`${path}/${id}`),
    orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
  });
  const database = { collection };
  const write = (ref: { path: string }, data: Record<string, unknown>, merge = true) => {
    writes.push(ref.path);
    values.set(ref.path, { ...(merge ? values.get(ref.path) : {}), ...data });
  };
  const tx = {
    get: (ref: any) => ref.get(), getAll: (...refs: any[]) => Promise.all(refs.map(ref => ref.get())),
    set: (ref: any, data: Record<string, unknown>, options?: { merge: boolean }) => write(ref, data, options?.merge),
    update: (ref: any, data: Record<string, unknown>) => write(ref, data),
  };
  return { values, writes, ref: doc('workspaces/target') as never, other: doc('workspaces/other') as never, tx: tx as never };
}

test('publication limits inherit finite global settings and preserve explicit zero or workspace-only null', async () => {
  const f = fixture();
  const inherited = await readPublicationQuota(f.ref, 'free_trial', undefined, at);
  assert.deepEqual(inherited, { month: '2026-11', used: 29, limit: 30, day: '2026-11-20', dailyUsed: 3, dailyLimit: 4 });
  assert.doesNotThrow(() => assertPublicationCapacity(inherited));
  for (const [quota, code] of [
    [{ monthlyPublicationLimit: 0, dailyPublicationLimit: null }, 'quota_exhausted'],
    [{ monthlyPublicationLimit: null, dailyPublicationLimit: 0 }, 'daily_publication_quota_exhausted'],
  ] as const) {
    f.values.set('private_admin_settings/workspace_target', { quota });
    const capped = await readPublicationQuota(f.ref, 'free_trial', f.tx, at);
    assert.throws(() => assertPublicationCapacity(capped), { code });
  }
  f.values.set('private_admin_settings/workspace_target', { quota: { monthlyPublicationLimit: null, dailyPublicationLimit: null } });
  const unlimited = await readPublicationQuota(f.ref, 'free_trial', f.tx, at);
  assert.equal(unlimited.limit, null);
  assert.equal(unlimited.dailyLimit, null);
  assert.doesNotThrow(() => assertPublicationCapacity(unlimited));
  const other = await readPublicationQuota(f.other, 'free_trial', undefined, at);
  assert.equal(other.limit, 30);
  assert.equal(other.dailyLimit, 4);
  f.values.delete('private_admin_settings/global');
  const fallback = await readPublicationQuota(f.other, 'free_trial', undefined, at);
  assert.equal(fallback.limit, SUBSCRIPTION_PLANS.free_trial.monthlyPostQuota);
  assert.equal(fallback.dailyLimit, null);
  assert.deepEqual(f.writes, []);
});

test('unlimited publication still debits and refunds real counters; returning to inheritance never resets usage', async () => {
  const f = fixture({ monthlyPublicationLimit: null, dailyPublicationLimit: null }, 50, 10);
  const globalBefore = structuredClone(f.values.get('private_admin_settings/global'));
  const current = await readPublicationQuota(f.ref, 'free_trial', f.tx, at);
  assert.doesNotThrow(() => assertPublicationCapacity(current));
  incrementPublicationUsage(f.tx, f.ref, current);
  const next = await readPublicationQuota(f.ref, 'free_trial', undefined, at);
  assert.equal(next.used, 51);
  assert.equal(next.dailyUsed, 11);
  assert.equal(f.values.get('workspaces/target')?.quotaUsed, 51);
  assert.equal(next.limit, null);
  f.values.set('private_admin_settings/workspace_target', { quota: {} });
  const inheritedAgain = await readPublicationQuota(f.ref, 'free_trial', f.tx, at);
  assert.equal(inheritedAgain.used, 51);
  assert.equal(inheritedAgain.dailyUsed, 11);
  assert.equal(inheritedAgain.limit, 30);
  assert.throws(() => assertPublicationCapacity(inheritedAgain), { code: 'quota_exhausted' });
  await releasePublicationUsage(f.tx, f.ref, { reservedMonth: '2026-11', reservedDay: '2026-11-20' }, at);
  const refunded = await readPublicationQuota(f.ref, 'free_trial', undefined, at);
  assert.equal(refunded.used, 50);
  assert.equal(refunded.dailyUsed, 10);
  assert.equal(f.values.get('workspaces/target')?.quotaUsed, 50);
  assert.deepEqual(f.values.get('private_admin_settings/global'), globalBefore);
});

test('unlimited publication rejects malformed counters before any debit and initializes only missing usage', async () => {
  for (const corrupt of [-1, NaN, 1.5, '6', null, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ['monthly', 'daily']) {
      const f = fixture({ monthlyPublicationLimit: null, dailyPublicationLimit: null }, field === 'monthly' ? corrupt : 50, field === 'daily' ? corrupt : 10);
      const original = structuredClone([...f.values]);
      await assert.rejects(readPublicationQuota(f.ref, 'free_trial', f.tx, at), { code: 'publication_quota_unavailable' });
      assert.deepEqual(f.writes, []);
      assert.deepEqual([...f.values], original);
    }
  }
  const empty = fixture({ monthlyPublicationLimit: null, dailyPublicationLimit: null });
  empty.values.delete('workspaces/target/publish_usage/2026-11');
  empty.values.delete('workspaces/target/publish_daily_usage/2026-11-20');
  const initial = await readPublicationQuota(empty.ref, 'free_trial', empty.tx, at);
  assert.equal(initial.used, 0);
  assert.equal(initial.dailyUsed, 0);
  incrementPublicationUsage(empty.tx, empty.ref, initial);
  assert.equal((await readPublicationQuota(empty.ref, 'free_trial', undefined, at)).used, 1);
});

test('billing reports explicit unlimited monthly publication for this workspace instead of a fallback plan cap', async () => {
  const f = fixture({ monthlyPublicationLimit: null, dailyPublicationLimit: null }, 50, 10);
  const read = (workspaceId: 'target' | 'other') => readWorkspaceBilling(new Request(`https://example.test/api/veloxa/billing?workspaceId=${workspaceId}`), {
    config: null,
    now: () => at.getTime(),
    authorizeWorkspace: async () => ({
      ref: workspaceId === 'target' ? f.ref : f.other, workspaceId,
      user: { uid: 'owner' }, workspace: { ownerUid: 'owner', subscriptionPlanId: 'free_trial' },
    }),
  } as never);
  const unlimited = await read('target');
  assert.equal(unlimited.publication.limit, null);
  assert.equal(unlimited.publication.used, 50);
  assert.ok(unlimited.plans.every(plan => plan.publicationLimit === null));
  const inherited = await read('other');
  assert.equal(inherited.publication.limit, 30);
  assert.equal(inherited.plans.find(plan => plan.id === 'free_trial')?.publicationLimit, 30);
  assert.deepEqual(f.writes, []);
});
