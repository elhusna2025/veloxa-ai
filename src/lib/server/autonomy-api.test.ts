import assert from 'node:assert/strict';
import test from 'node:test';
import { publicAutonomyActivity } from './autonomy-api';

test('scheduled activity exposes progress and receipts while keeping recovery checkpoints private', () => {
  const raw = {
    state: 'retry_generation', scheduledAt: 1000, topic: 'Layanan bisnis', format: 'carousel',
    draftId: 'draft_abc', error: 'Pemeriksaan dilanjutkan otomatis.', retryAt: 2000,
    scriptResult: { privateCopy: 'private' }, agentSession: { sessionId: 'sess_private' },
    scriptCreationStarted: true, scriptKey: 'private-key', generationInput: { topic: 'private request' },
    artworkRepair0: { description: 'private observations' }, profileFingerprint: 'private profile',
    receipts: [{ status: 'published', handle: '@bisnis', accountName: 'Bisnis', permalink: 'https://www.instagram.com/p/example/', providerContainerId: 'private', token: 'private' }],
  };
  const projected = publicAutonomyActivity('slot_1000', raw);
  assert.deepEqual(projected, { id: 'slot_1000', state: raw.state, scheduledAt: 1000, topic: raw.topic,
    format: 'carousel', draftId: 'draft_abc', error: raw.error, retryAt: 2000,
    receipts: [{ status: 'published', handle: '@bisnis', accountName: 'Bisnis', permalink: raw.receipts[0].permalink }],
  });
  assert.equal(JSON.stringify(projected).includes('private'), false);
});
