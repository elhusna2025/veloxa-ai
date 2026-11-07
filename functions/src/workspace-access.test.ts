import test from 'node:test';
import assert from 'node:assert/strict';
import { hasWorkspaceAccess, isVerifiedAdmin } from '../../src/lib/veloxa-workspace-policy';

test('tenant isolation: owner and members may act, another customer may not', () => {
  const workspace = { ownerUid: 'customer-a', memberUids: ['collaborator-a'] };
  assert.equal(hasWorkspaceAccess('customer-a', workspace), true);
  assert.equal(hasWorkspaceAccess('collaborator-a', workspace), true);
  assert.equal(hasWorkspaceAccess('customer-b', workspace), false);
  assert.equal(hasWorkspaceAccess('customer-b', { ownerUid: 'customer-a', memberUids: 'customer-b' }), false);
});

test('an email address alone cannot grant administrator access', () => {
  assert.equal(isVerifiedAdmin({ email: 'sosrospg@gmail.com', email_verified: false }), false);
  assert.equal(isVerifiedAdmin({ email: 'sosrospg@gmail.com', email_verified: true }), true);
  assert.equal(isVerifiedAdmin({ role: 'admin' }), true);
  assert.equal(isVerifiedAdmin({ email: 'customer@example.test', email_verified: true }), false);
});
