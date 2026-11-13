import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { AdminIncidentSource, AdminIncidentStatus } from '../admin-incidents';
import { getAdminIncidents, updateAdminIncident } from './admin-incidents';
import { ruleKey } from './autonomy-api';
import { ApiError } from './http';

const endpoint = 'http://localhost/api/veloxa/admin/incidents/';
const authorize = async () => ({ uid: 'operator', role: 'admin' } as Partial<DecodedIdToken> as DecodedIdToken);
const patch = (source: AdminIncidentSource, status: AdminIncidentStatus, expectedRevision: number) => new Request(endpoint, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ source, status, expectedRevision, note: 'Periksa akun tujuan sebelum mengambil tindakan.' }),
});

test('incident reads and writes require an operator before accessing the database', async () => {
  const member = async () => ({ uid: 'member' } as DecodedIdToken);
  const assertForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;
  await assert.rejects(getAdminIncidents(new Request(endpoint), { authorize: member }), assertForbidden);
  await assert.rejects(updateAdminIncident(patch({ kind: 'scheduler', lastCompletedAt: null }, 'resolved', 0), { authorize: member }), assertForbidden);
});

test('incident triage records one audited status change and preserves Otonom delivery records', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1):\d+$/);
  const projectId = `demo-incident-${randomUUID().slice(0, 8)}`;
  const app = initializeApp({ projectId }, projectId);
  const database = getFirestore(app);
  const now = Date.now();
  const workspaceId = 'ws_berez';
  const businessId = 'b_12345678-1234-1234-1234-123456789012';
  const workspace = database.collection('workspaces').doc(workspaceId);
  const heartbeat = database.collection('system_operations').doc('organic_scheduler');
  const primary = database.collection('auto_content_rules').doc(ruleKey(workspaceId, 'primary'));
  const secondary = database.collection('auto_content_rules').doc(ruleKey(workspaceId, businessId));
  const uncertain = primary.collection('jobs').doc('uncertain');
  const checking = secondary.collection('jobs').doc('checking');
  const skipped = secondary.collection('jobs').doc('skipped');
  const healthy = secondary.collection('jobs').doc('published');
  const sameRule = { workspaceId, ownerUid: 'workspace-owner', revision: 4, updatedAt: now - 1000 };
  const batch = database.batch();
  batch.set(workspace, { name: 'Berez ERP', ownerUid: 'workspace-owner' });
  batch.set(workspace.collection('business_contexts').doc(businessId), { brand: { businessName: 'Cendekia' } });
  batch.set(heartbeat, { at: now - 2000, completedAt: now - 900_000 });
  batch.set(primary, { ...sameRule, businessId: 'primary', enabled: false, lastError: 'Izin akun tujuan berakhir private-error' });
  batch.set(secondary, { ...sameRule, businessId, enabled: true, pendingReconciliation: checking.id, processingJob: 'overdue', processingUntil: now - 500 });
  batch.set(uncertain, { state: 'needs_attention', createdAt: now - 1000, receipts: [{ status: 'unknown', channel: 'facebook', error: 'private-error' }] });
  batch.set(checking, { state: 'needs_attention', createdAt: now - 2000 });
  batch.set(skipped, { state: 'skipped', createdAt: now - 3000, error: 'Kuota harian habis' });
  batch.set(primary.collection('jobs').doc('failed-1'), { state: 'failed', createdAt: now - 7000 });
  batch.set(primary.collection('jobs').doc('failed-2'), { state: 'failed', createdAt: now - 8000 });
  batch.set(healthy, { state: 'published', createdAt: now - 500 });

  try {
    await batch.commit();
    const options = { database, authorize, now: () => now, schedulerConfigured: true };
    const read = () => getAdminIncidents(new Request(endpoint), options);
    const first = await read();
    assert.deepEqual(first.incidents.map(incident => incident.source.kind).sort(), ['process', 'rule', 'scheduler', 'slot', 'slot', 'slot', 'slot']);
    assert.deepEqual(first.incidents.filter(incident => incident.failedSlots).map(incident => [incident.businessName, incident.failedSlots]), [['Berez ERP', 2], ['Berez ERP', 2]]);
    assert.doesNotMatch(JSON.stringify(first), /private-error|workspace-owner|"jobId":"checking"/);
    const incident = first.incidents.find(row => row.source.kind === 'slot' && row.source.jobId === uncertain.id)!;
    assert.equal(incident.workspaceName, 'Berez ERP');
    assert.equal(first.incidents.find(row => row.source.kind === 'process')?.businessName, 'Cendekia');
    assert.equal(incident.receipts?.[0].status, 'unknown');
    assert.equal(incident.status, 'open');
    assert.equal(first.partial, false);
    const before = await uncertain.get();
    const beforeRule = await primary.get();
    const outcomes = await Promise.allSettled([0, 1].map(() => updateAdminIncident(patch(incident.source, 'investigating', 0), options)));
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(outcomes.some(result => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.code === 'incident_conflict'));
    const started = (await read()).incidents.find(row => row.id === incident.id)!;
    assert.equal(started.status, 'investigating');
    assert.equal(started.history[0].actor, 'operator');
    await updateAdminIncident(patch(incident.source, 'resolved', 1), options);
    const resolved = (await read()).incidents.find(row => row.id === incident.id)!;
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.detected, true);
    assert.deepEqual(resolved.history.map(entry => entry.status), ['resolved', 'investigating']);
    await updateAdminIncident(patch(incident.source, 'open', 2), options);
    const reopened = (await read()).incidents.find(row => row.id === incident.id)!;
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.revision, 3);
    assert.deepEqual((await uncertain.get()).data(), before.data());
    assert.deepEqual((await primary.get()).data(), beforeRule.data());
    assert.equal((await database.collection('platform_admin_audit').where('incidentId', '==', incident.id).get()).size, 3);

    const scheduler = first.incidents.find(row => row.source.kind === 'scheduler')!;
    await heartbeat.update({ completedAt: now - 1000 });
    await assert.rejects(updateAdminIncident(patch(scheduler.source, 'resolved', 0), options), { code: 'incident_source_changed' });
    await assert.rejects(updateAdminIncident(patch({ kind: 'slot', workspaceId, businessId, jobId: checking.id }, 'resolved', 0), options), { code: 'incident_source_changed' });
  } finally {
    await deleteApp(app);
  }
});
