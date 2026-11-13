import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { blankBusinessProfile } from '../business-context';
import { getAdminIntegrations } from './admin-integrations';
import { META_ADS_SCOPES } from './meta-oauth';

const request = new Request('http://localhost/api/veloxa/admin/integrations/?workspaceId=ws_integration');

test('integration administration rejects ordinary workspace users', async () => {
  await assert.rejects(getAdminIntegrations(request, {
    authorize: async () => ({ uid: 'owner' } as DecodedIdToken),
  }), { status: 403 });
});

test('integration overview scopes connections to businesses and returns campaign metrics without credentials', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(localhost|127\.0\.0\.1):\d+$/);
  const projectId = 'demo-integrations-' + randomUUID().slice(0, 8);
  const app = initializeApp({ projectId }, projectId);
  const database = getFirestore(app);
  const workspace = database.collection('workspaces').doc('ws_integration');
  const credential = workspace.collection('meta_ads_credentials').doc('current');
  const now = 1_790_000_000_000;
  try {
    const batch = database.batch();
    batch.set(workspace, {
      name: 'Berez', ownerUid: 'owner',
      snapshotJson: JSON.stringify({ brand: blankBusinessProfile(workspace.id, 'primary', 'Berez') }),
    });
    batch.set(workspace.collection('business_contexts').doc('primary'), { connectionIds: ['facebook_123'] });
    batch.set(workspace.collection('private_meta_connections').doc('facebook_123'), {
      channel: 'facebook', accountId: '123', accountName: 'Berez Page', expiresAt: now + 10_000, encryptedToken: 'sensitive-page-token',
    });
    batch.set(workspace.collection('private_meta_connections').doc('instagram_789'), {
      channel: 'instagram', accountId: '789', handle: '@second-account', expiresAt: now - 10_000,
    });
    batch.set(credential, { scopes: META_ADS_SCOPES, authorizedBy: 'owner', expiresAt: 0, encryptedToken: 'sensitive-ads-token' });
    batch.set(workspace.collection('meta_ads_executions').doc('campaign'), {
      title: 'Demo ERP', businessId: 'primary', status: 'paused', adAccountName: 'Berez Ads',
      updatedAt: now, totalBudgetIdr: 100_000,
      insights: { spendIdr: 0, impressions: 0, clicks: 0, asOf: now }, operation: 'private-operation',
    });
    await batch.commit();
    const read = () => getAdminIntegrations(request, {
      database, now: () => now, authorize: async () => ({ uid: 'operator', role: 'admin' } as Partial<DecodedIdToken> as DecodedIdToken),
    });
    const overview = await read();
    assert.equal(overview.advertising.status, 'connected');
    assert.equal(overview.accounts.find(account => account.channel === 'facebook')?.business, 'Berez');
    assert.equal(overview.accounts.find(account => account.channel === 'instagram')?.business, null);
    assert.equal(overview.campaigns[0].title, 'Demo ERP');
    assert.equal(overview.campaigns[0].insights?.spendIdr, 0);
    assert.doesNotMatch(JSON.stringify(overview), /sensitive-|private-operation|authorizedBy/);
    await credential.update({ authorizedBy: 'previous-owner' });
    assert.equal((await read()).advertising.status, 'disconnected');
  } finally {
    await deleteApp(app);
  }
});
