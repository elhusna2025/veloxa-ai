import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImmutableProfileFields } from './veloxa-auth';

test('payload profil menjaga field immutable yang ada dan tidak menambah field yang hilang pada dokumen lama', () => {
  const userFields = buildImmutableProfileFields(
    { uid: 'user-existing', id: 'user-id-existing', role: 'user' },
    { uid: 'user-new', id: 'user-id-new', role: 'admin', createdAt: 'now' },
  );
  assert.deepEqual(userFields, {
    uid: 'user-existing',
    id: 'user-id-existing',
    role: 'user',
  });
  assert.equal(Object.hasOwn(userFields, 'createdAt'), false);

  const workspaceFields = buildImmutableProfileFields(
    { id: 'workspace-existing', ownerUid: 'owner-existing' },
    { id: 'workspace-new', ownerUid: 'owner-new', createdAt: 'now' },
  );
  assert.deepEqual(workspaceFields, {
    id: 'workspace-existing',
    ownerUid: 'owner-existing',
  });
  assert.equal(Object.hasOwn(workspaceFields, 'createdAt'), false);
});

test('payload profil mempertahankan timestamp dan ID lama serta menginisialisasi field untuk dokumen baru', () => {
  const existingFields = buildImmutableProfileFields(
    {
      uid: 'user-existing',
      id: 'user-id-existing',
      role: 'user',
      createdAt: '2024-01-02T03:04:05.000Z',
    },
    {
      uid: 'user-new',
      id: 'user-id-new',
      role: 'admin',
      createdAt: '2025-01-02T03:04:05.000Z',
    },
  );
  assert.deepEqual(existingFields, {
    uid: 'user-existing',
    id: 'user-id-existing',
    role: 'user',
    createdAt: '2024-01-02T03:04:05.000Z',
  });

  const newFields = buildImmutableProfileFields(null, {
    uid: 'user-new',
    role: 'user',
    createdAt: '2025-01-02T03:04:05.000Z',
  });
  assert.deepEqual(newFields, {
    uid: 'user-new',
    role: 'user',
    createdAt: '2025-01-02T03:04:05.000Z',
  });

  const newWorkspaceFields = buildImmutableProfileFields(null, {
    id: 'workspace-new',
    ownerUid: 'owner-new',
    createdAt: '2025-01-02T03:04:05.000Z',
  });
  assert.deepEqual(newWorkspaceFields, {
    id: 'workspace-new',
    ownerUid: 'owner-new',
    createdAt: '2025-01-02T03:04:05.000Z',
  });
});
