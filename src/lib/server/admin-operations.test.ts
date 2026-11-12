import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { blankBusinessProfile } from '../business-context';
import type { AdminOperations, AdminOverview, AdminWorkspaceDetail, AdminWorkspacePage } from '../admin-operations';
import { adminReceipts, countConfirmedToday, getAdminOperations, pauseAdminRule } from './admin-operations';
import { ruleKey } from './autonomy-api';
import { wibDay, wibMonth } from './clock';
import { ApiError } from './http';

const actor = (properties: Partial<DecodedIdToken> = {}) => async () => ({ uid: 'operator', ...properties }) as DecodedIdToken;
const request = (query = '') => new Request('http://localhost/api/veloxa/admin/' + query);
const pause = (workspaceId: string, businessId: string, expectedRevision: number, extra = {}) => new Request(request().url, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workspaceId, businessId, expectedRevision, reason: 'Periksa hasil yang belum pasti.', ...extra }),
});
const hasStatus = (status: number) => (error: unknown) => error instanceof ApiError && error.status === status;

function withUnavailableGroupIndexes(database: Firestore, error: Error): Firestore {
  const rejectQuery = (query: object): object => new Proxy(query, {
    get(target, key) {
      if (key === 'get') return async () => { throw error; };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? (...args: unknown[]) => rejectQuery(value.apply(target, args)) : value;
    },
  });
  return new Proxy(database, {
    get(target, key) {
      if (key === 'collectionGroup') return (name: string) => rejectQuery(target.collectionGroup(name));
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('admin reads and pause reject unauthenticated and ordinary users before contacting storage', async () => {
  const unauthorized = async () => { throw new ApiError(401, 'Sign in'); };
  for (const [authorize, status] of [
    [unauthorized, 401],
    [actor({ email: 'member@example.test', email_verified: true }), 403],
    [actor({ email: 'sosrospg@gmail.com', email_verified: false }), 403],
  ] as const) {
    await assert.rejects(getAdminOperations(request(), { authorize }), hasStatus(status));
    await assert.rejects(pauseAdminRule(pause('ws', 'primary', 0), { authorize }), hasStatus(status));
  }
  await assert.rejects(pauseAdminRule(pause('ws', 'primary', 0, { enabled: true }), { authorize: actor({ role: 'admin' }) }), { name: 'ZodError' });
});

test('count deduplicates draft across Meta accounts and query windows and uses Jakarta day', () => {
  const start = Date.parse('2026-11-13T00:00:00+07:00');
  const receipt = (delta: number, status = 'published', id = 'confirmed') =>
    ({ status, publishedAt: new Date(start + delta).toISOString(), externalPostId: id });
  assert.equal(countConfirmedToday([
    { path: 'a', receipts: [receipt(0), receipt(50)] },
    { path: 'a', receipts: [receipt(0)] },
    { path: 'b', receipts: [receipt(-1), receipt(86_400_000)] },
    { path: 'c', receipts: [receipt(10, 'unknown'), receipt(10, 'published', '')] },
    { path: 'd', receipts: [receipt(86_399_999)] },
    { path: 'e', receipts: [{ status: 'published', providerContainerId: 'proof', confirmedAt: new Date(start + 30).toISOString() }] },
  ], start), 3);
});

test('admin receipt omits credentials, raw provider errors and untrusted links', () => {
  const rows = adminReceipts([
    { channel: 'instagram', status: 'published', handle: '@brand', encryptedToken: 'private', permalink: 'https://www.instagram.com/p/sample/?access_token=secret' },
    { channel: 'facebook', status: 'published', accountName: 'Page', permalink: 'https://www.facebook.com.evil.test/p' },
    { channel: 'facebook', status: 'unknown', error: 'raw provider', permalink: 'https://www.facebook.com/1' },
    { channel: 'facebook', status: 'published', permalink: 'https://www.facebook.com/permalink.php?story_fbid=42&id=35' },
  ]);
  assert.deepEqual(rows, [
    { channel: 'instagram', account: '@brand', status: 'published', permalink: 'https://www.instagram.com/p/sample/' },
    { channel: 'facebook', account: 'Page', status: 'published', permalink: null },
    { channel: 'facebook', account: 'facebook', status: 'unknown', permalink: null },
    { channel: 'facebook', account: 'facebook', status: 'published', permalink: 'https://www.facebook.com/permalink.php?story_fbid=42&id=35' },
  ]);
});

test('admin API reads Firestore data, keeps businesses isolated, and pauses exactly one rule atomically', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1):\d+$/);
  const projectId = process.env.VELOXA_ADMIN_EMULATOR_PROJECT || 'demo-veloxa-admin-test';
  assert.match(projectId, /^demo-/);
  const app = initializeApp({ projectId }, 'veloxa-admin-emulator');
  const db = getFirestore(app);
  const now = Date.now();
  const start = Date.parse(wibDay(new Date(now)) + 'T00:00:00+07:00');
  const businessId = 'b_12345678-1234-1234-1234-123456789012';
  const ws = db.collection('workspaces').doc('ws_example');
  const primary = db.collection('auto_content_rules').doc(ruleKey(ws.id, 'primary'));
  const other = db.collection('auto_content_rules').doc(ruleKey(ws.id, businessId));
  const queued = primary.collection('jobs').doc('queued');
  const processing = primary.collection('jobs').doc('processing');
  const rule = { workspaceId: ws.id, ownerUid: 'owner', enabled: true, revision: 4, nextSlotMs: now + 60_000, nextDueMs: now + 30_000, lastError: '', config: { reference: 'private-config' } };
  const batch = db.batch();
  batch.set(ws, { name: 'Berez Test', ownerUid: 'owner', subscriptionPlanId: 'free_trial', onboardingCompleted: true,
    snapshotJson: JSON.stringify({ brand: blankBusinessProfile(ws.id,'primary','Berez Test'), secret: 'private-snapshot' }) });
  batch.set(db.collection('workspaces').doc('empty'), { name: 'New Workspace', onboardingCompleted: false });
  batch.set(ws.collection('business_contexts').doc('primary'), { revision: 1, connectionIds: ['instagram_11'] });
  batch.set(ws.collection('business_contexts').doc(businessId), { revision: 1, connectionIds: ['facebook_22'], brand: blankBusinessProfile(ws.id,businessId,'Cendekia Test') });
  batch.set(ws.collection('private_meta_connections').doc('instagram_11'), { channel:'instagram', accountId:'11', handle:'berez', encryptedToken:'private-ig' });
  batch.set(ws.collection('private_meta_connections').doc('facebook_22'), { channel:'facebook', accountId:'22', accountName:'Cendekia Page', expiresAt: now - 1000, encryptedToken:'private-fb' });
  batch.set(ws.collection('publish_usage').doc(wibMonth()), { count: 2 });
  batch.set(ws.collection('generation_usage').doc(wibDay()), { count: 3 });
  const confirmed = { status: 'published', publishedAt: new Date(start).toISOString(), externalPostId: 'confirmed' };
  batch.set(ws.collection('publish_jobs').doc('completed'), { completedAt: start + 1, lastConfirmedAt: start, receipts: [confirmed, confirmed] });
  batch.set(ws.collection('publish_jobs').doc('processing'), { completedAt: null, lastConfirmedAt: start, receipts: [confirmed] });
  batch.set(ws.collection('publish_jobs').doc('unknown'), { completedAt: start + 2, receipts: [{ ...confirmed, status: 'unknown' }] });
  batch.set(primary, { ...rule, businessId: 'primary', pendingJob: queued.id, processingJob: processing.id, processingRun: 'lease' });
  batch.set(other, { ...rule, businessId, nextSlotMs: now + 120_000, pendingReconciliation: 'incident' });
  batch.set(queued, { createdAt: now, scheduledAt: now, state: 'queued', ruleRevision: 4, draftId: 'queued-draft', generationAttempts: 1, publicationAttempts: 1 });
  batch.set(processing, { createdAt: now, scheduledAt: now, state: 'publishing', ruleRevision: 4 });
  batch.set(other.collection('jobs').doc('incident'), { createdAt: now, scheduledAt: now, state: 'needs_attention',
    topic: 'private-prompt', receipts: [{ status: 'unknown', channel: 'facebook', accountName: 'Cendekia Page', error: 'private-error' }] });
  try {
    await batch.commit();
    const deps = { database: db, authorize: actor({ role: 'admin' }), health: async () => ({ schedulerReady: true, lastTickAt: now }) };
    const overview = await getAdminOperations(request(),deps) as AdminOverview;
    assert.equal(overview.activeWorkspaces,1);
    assert.equal(overview.publishedToday,2);
    assert.equal(overview.attention,1);
    assert.equal(overview.recovering,1);
    assert.equal(overview.actions[0].state,'reconciling');
    assert.equal(overview.actions[1].retryAt,now+30_000);
    assert.equal(overview.upcoming[1].businessName,'Cendekia Test');
    const list = await getAdminOperations(request('?view=workspaces&q=Berez'), deps) as AdminWorkspacePage;
    assert.deepEqual(list.items.map(item=>item.id), [ws.id]);
    const exact = await getAdminOperations(request('?view=workspaces&q=ws_example'), deps) as AdminWorkspacePage;
    assert.equal(exact.items[0]?.name,'Berez Test');
    const detail = await getAdminOperations(request('?view=workspace&workspaceId=ws_example'), deps) as AdminWorkspaceDetail;
    assert.equal(detail.publication.used,2);
    assert.equal(detail.generation.used,3);
    assert.deepEqual(detail.businesses.map(item => item.accounts.map(account => [account.label,account.ready])), [[['@berez',true]], [['Cendekia Page',false]]]);
    const missing = await getAdminOperations(request('?view=workspace&workspaceId=empty'), deps) as AdminWorkspaceDetail;
    assert.equal(missing.profileStatus,'missing');
    const ops = await getAdminOperations(request('?view=operations&state=attention'), deps) as AdminOperations;
    assert.deepEqual(ops.jobs.map(job => job.state),['reconciling']);
    const missingIndex = Object.assign(new Error('The query requires a COLLECTION_GROUP_ASC index for collection jobs.'), { code: 3 });
    const fallback = { ...deps, database: withUnavailableGroupIndexes(db, missingIndex) };
    assert.deepEqual(await getAdminOperations(request(), fallback), overview);
    assert.deepEqual(await getAdminOperations(request('?view=operations&state=attention'), fallback), ops);
    const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), { code: 7 });
    await assert.rejects(getAdminOperations(request(), { ...deps, database: withUnavailableGroupIndexes(db, permissionError) }), permissionError);
    assert.doesNotMatch(JSON.stringify({ overview, detail, ops }), /private-|encryptedToken|ownerUid/);
    await assert.rejects(pauseAdminRule(pause(ws.id,'primary',3), deps), hasStatus(409));
    const concurrent = await Promise.allSettled([pauseAdminRule(pause(ws.id,'primary',4), deps), pauseAdminRule(pause(ws.id,'primary',4), deps)]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length,1);
    const failed = concurrent.find(result => result.status === 'rejected');
    assert.ok(failed && hasStatus(409)(failed.reason));
    const [saved, otherRule, cancelled, untouched, audit] = await Promise.all([primary.get(), other.get(), queued.get(), processing.get(), db.collection('platform_admin_audit').get()]);
    assert.equal(saved.get('enabled'),false);
    assert.equal(saved.get('processingRun'),'lease');
    assert.equal(saved.get('revision'),5);
    assert.equal(otherRule.get('enabled'),true);
    assert.equal(cancelled.get('state'),'cancelled');
    assert.equal(untouched.get('state'),'publishing');
    assert.equal(audit.size,1);
    assert.equal(audit.docs[0].get('actorUid'),'operator');
    assert.equal(audit.docs[0].get('businessId'),'primary');
    const updated = await getAdminOperations(request('?view=workspace&workspaceId=ws_example'), deps) as AdminWorkspaceDetail;
    assert.equal(updated.pauseAudit?.[0].businessName, 'Berez Test');
    assert.equal(updated.pauseAudit?.[0].reason, 'Periksa hasil yang belum pasti.');
    assert.equal(updated.pauseAudit?.[0].processing, true);
  } finally { await deleteApp(app); }
});
