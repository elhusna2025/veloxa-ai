import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkspaceSnapshotSyncPayload } from './veloxa-firestore-repo';

const snapshot = {
  updatedAtIso: '2025-02-03T04:05:06.000Z',
  brand: {
    businessName: 'Workspace bisnis',
    category: 'cafe_fnb',
    city: 'Jakarta',
    targetAudience: 'Pelanggan lokal',
    brandTone: 'Ramah',
  },
  autonomyConfig: { enabled: false, targetChannels: [] },
} as unknown as Parameters<typeof buildWorkspaceSnapshotSyncPayload>[0]['snapshot'];

const buildPayload = (existingData: Record<string, unknown> | null) =>
  buildWorkspaceSnapshotSyncPayload({
    workspaceId: 'ws_existing',
    ownerUid: 'owner-current',
    memberUids: ['owner-current'],
    existingData,
    snapshot,
    serialized: '{"brand":{}}',
  });

test('payload sinkronisasi menjaga field immutable workspace lama dan menginisialisasinya hanya untuk dokumen baru', async (t) => {
  await t.test('workspace legacy tanpa createdAt tidak menerima createdAt sintetis', () => {
    const existing = { id: 'ws_existing', ownerUid: 'owner-original', memberUids: ['owner-original'] };
    const payload = buildPayload(existing);

    assert.equal(Object.hasOwn(payload, 'createdAt'), false);
    assert.equal(payload.id, existing.id);
    assert.equal(payload.ownerUid, existing.ownerUid);
  });

  await t.test('createdAt yang sudah ada tetap sama', () => {
    const existing = {
      id: 'ws_existing',
      ownerUid: 'owner-original',
      createdAt: '2021-06-07T08:09:10.000Z',
      memberUids: ['owner-original'],
    };
    const payload = buildPayload(existing);

    assert.equal(payload.createdAt, existing.createdAt);
    assert.equal(payload.id, existing.id);
    assert.equal(payload.ownerUid, existing.ownerUid);
  });

  await t.test('workspace baru mendapat id, ownerUid, dan createdAt awal', () => {
    const payload = buildPayload(null);

    assert.equal(payload.id, 'ws_existing');
    assert.equal(payload.ownerUid, 'owner-current');
    assert.equal(payload.createdAt, snapshot.updatedAtIso);
    assert.equal(payload.subscriptionPlanId, 'free_trial');
  });
});
