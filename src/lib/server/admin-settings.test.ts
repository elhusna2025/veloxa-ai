import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_CONTENT_MODELS } from '../admin-settings';
import { adminQuotaRefs, getAdminSettings, resolveAdminModels, resolveAdminQuota, updateAdminSettings } from './admin-settings';
import { ApiError } from './http';

const url = 'http://localhost/api/veloxa/admin/settings/';
const authorize = async () => ({ uid: 'settings_operator', role: 'admin' }) as Partial<DecodedIdToken> as DecodedIdToken;
const patch = (data: object) => new Request(url, { method: 'PATCH', body: JSON.stringify({ reason: 'Uji perubahan kuota workspace.', ...data }) });
const status = (expected: number) => (error: unknown) => error instanceof ApiError && error.status === expected;

test('settings authentication runs before any storage access and rejects mixed restore edits', async () => {
  const member = async () => ({ uid: 'member', email_verified: true }) as DecodedIdToken;
  const unauthenticated = async () => { throw new ApiError(401, 'Sign in'); };
  await assert.rejects(getAdminSettings(new Request(url), { authorize: unauthenticated }), status(401));
  await assert.rejects(getAdminSettings(new Request(url), { authorize: member }), status(403));
  await assert.rejects(updateAdminSettings(patch({ expectedRevision: 0, models: {} }), { authorize: member }), status(403));
  await assert.rejects(updateAdminSettings(patch({ expectedRevision: 1, restoreRevision: 0, models: {} }), { authorize }), { name: 'ZodError' });
  await assert.rejects(updateAdminSettings(patch({ expectedRevision: 0, workspaceId: 'ws', quota: { dailyDraftLimit: -1 } }), { authorize }), { name: 'ZodError' });
});

test('quota overrides honor scope, explicit zero, and an unlimited draft workspace', () => {
  const plan = { plans: { free_trial: { dailyDraftLimit: 8, monthlyPublicationLimit: 30, dailyPublicationLimit: 4 } } };
  assert.deepEqual(resolveAdminQuota('free_trial', plan, { quota: { dailyDraftLimit: null, dailyPublicationLimit: 0 } }), {
    dailyDraftLimit: null, monthlyPublicationLimit: 30, dailyPublicationLimit: 0,
  });
  assert.deepEqual(resolveAdminQuota('starter_500k', plan), {});
  assert.deepEqual(resolveAdminQuota('free_trial', undefined, { quota: { dailyDraftLimit: 'unlimited' } }), {});
});

test('settings revisions are scoped, audited, concurrency-safe and restorable without changing usage', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1):\d+$/);
  const projectId = 'demo-veloxa-admin-settings';
  const app = initializeApp({ projectId }, 'veloxa-admin-settings-emulator');
  const database = getFirestore(app);
  const deps = { authorize, database, now: () => 1_794_500_000_000 };
  const workspaceId = 'settings_fixture_' + Date.now();
  const otherId = workspaceId + '_other';
  const refs = adminQuotaRefs(database, workspaceId, 'free_trial');
  const workspace = database.collection('workspaces').doc(workspaceId);
  const other = database.collection('workspaces').doc(otherId);
  const usage = workspace.collection('publish_usage').doc('2026-11');
  const legacy = database.collection('platform_configs').doc('generation_' + workspaceId);
  const previousAllowlist = process.env.VELOXA_ADMIN_SCRIPT_MODELS;
  process.env.VELOXA_ADMIN_SCRIPT_MODELS = 'gpt-6.1-sol';
  const read = (id?: string) => getAdminSettings(new Request(id ? url + '?workspaceId=' + id : url), deps);
  const save = (data: object) => updateAdminSettings(patch(data), deps);
  try {
    await Promise.all([
      workspace.set({ name: 'Berez Test', subscriptionPlanId: 'free_trial' }), other.set({ name: 'Cendekia Test' }),
      usage.set({ count: 3 }), legacy.set({ workspaceId, enabled: true, mode: 'development' }),
    ]);
    const initial = await read();
    assert.equal(initial.scope, 'global');
    assert.equal(initial.revision, 0);
    assert.equal(initial.plans.find(plan => plan.id === 'free_trial')?.monthlyPublicationLimit, 20);
    assert.deepEqual(initial.defaultModels, DEFAULT_CONTENT_MODELS);
    assert.deepEqual(await save({ expectedRevision: 0, plans: [{ id: 'free_trial', dailyDraftLimit: 9, monthlyPublicationLimit: 37, dailyPublicationLimit: 7 }] }), { revision: 1 });
    const inherited = await read(workspaceId);
    assert.equal(inherited.scope, 'workspace');
    assert.deepEqual(inherited.effectiveQuota, { dailyDraftLimit: null, monthlyPublicationLimit: 37, dailyPublicationLimit: 7 });
    await assert.rejects(save({ workspaceId, expectedRevision: 0, models: { scriptModel: 'unavailable-model' } }), status(400));
    await assert.rejects(save({ workspaceId: 'missing-workspace', expectedRevision: 0, quota: {} }), status(404));
    const edits = await Promise.allSettled(Array.from({ length: 2 }, () => save({
      workspaceId, expectedRevision: 0, models: { scriptModel: 'gpt-6.1-sol' }, quota: { dailyDraftLimit: 2, monthlyPublicationLimit: 12 },
    })));
    assert.equal(edits.filter(edit => edit.status === 'fulfilled').length, 1);
    const failed = edits.find(edit => edit.status === 'rejected');
    assert.ok(failed && status(409)(failed.reason));
    const scoped = await read(workspaceId);
    assert.equal(scoped.scope, 'workspace');
    assert.deepEqual(scoped.effectiveQuota, { dailyDraftLimit: 2, monthlyPublicationLimit: 12, dailyPublicationLimit: 7 });
    assert.deepEqual(await resolveAdminModels(database, workspaceId), { scriptModel: 'gpt-6.1-sol' });
    assert.deepEqual(await resolveAdminModels(database, otherId), {});
    delete process.env.VELOXA_ADMIN_SCRIPT_MODELS;
    assert.deepEqual(await resolveAdminModels(database, workspaceId), {});
    const retired = await read(workspaceId);
    assert.equal(retired.models.scriptModel, 'gpt-6.1-sol');
    assert.equal(retired.effectiveModels.scriptModel, DEFAULT_CONTENT_MODELS.scriptModel);
    assert.equal(scoped.audit[0]?.actor, 'settings_operator');
    assert.equal(scoped.audit[0]?.action, 'update');
    assert.ok(scoped.audit[0]?.changes?.includes('Publikasi bulanan · Ikuti paket → 12'));
    assert.deepEqual(await save({ workspaceId, expectedRevision: 1, restoreRevision: 0 }), { revision: 2 });
    const restored = await read(workspaceId);
    assert.equal(restored.scope, 'workspace');
    assert.deepEqual(restored.effectiveQuota, inherited.effectiveQuota);
    assert.deepEqual(restored.audit.map(row => [row.revision, row.action, row.restoredFrom]), [[2, 'restore', 0], [1, 'update', undefined]]);
    assert.deepEqual(await resolveAdminModels(database, workspaceId), {});
    assert.equal((await usage.get()).get('count'), 3);
    assert.equal((await read()).revision, 1);
  } finally {
    if (previousAllowlist === undefined) delete process.env.VELOXA_ADMIN_SCRIPT_MODELS;
    else process.env.VELOXA_ADMIN_SCRIPT_MODELS = previousAllowlist;
    try { await Promise.all([database.recursiveDelete(refs.plan), database.recursiveDelete(refs.workspace), workspace.delete(), other.delete(), usage.delete(), legacy.delete()]); }
    finally { await deleteApp(app); }
  }
});
