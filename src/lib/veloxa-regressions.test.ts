import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_PRESETS, buildMetaAdCampaignPlan, canConsumePostingQuota, runAutonomousQualityRepairLoop, runMetaAdsAutonomousOptimizer, generateBrandContentDraft } from './veloxa-engine';
import { buildWorkspaceIdForUid, registerNewVeloxaAccount, signInQuickRoleSession, signInWithEmailPasswordOrRegister, sendVeloxaPasswordReset } from './veloxa-auth';
import { buildRealInitialWorkspaceSnapshot, getDefaultFirebaseConnectionConfig, syncWorkspaceSnapshotToStore, mergeOnboardingSnapshot } from './veloxa-firestore-repo';
import { calculateFirestoreCostSavingsPct } from './veloxa-local-first';
import type { MetaAdsAccountConnection } from './veloxa-types';

const account: MetaAdsAccountConnection = { connected: true, adAccountId: 'act_123', adAccountName: 'Test', businessPortfolioName: 'Test', currency: 'IDR', paymentMethodLabel: 'Test', dailyHardCapIdr: 100_000, monthlyHardCapIdr: 1_000_000, autoOptimizeEnabled: true, autoBoostOrganicWinners: false };
const campaign = (overrides: Partial<MetaAdsAccountConnection> = {}) => buildMetaAdCampaignPlan({ brand: BRAND_PRESETS.running_event, metaAccount: { ...account, ...overrides }, objective: 'WHATSAPP_MESSAGES', promotedOfferingTitle: 'Test offer', requestedDailyBudgetIdr: 100_000, durationDays: 7 });

test('invalid login and registration cannot create local identities; quick admin sessions are disabled', async () => {
  await assert.rejects(signInWithEmailPasswordOrRegister({ email: 'sosrospg@gmail.com', password: 'x' }));
  await assert.rejects(registerNewVeloxaAccount({ name: 'Test', email: 'test@example.test', password: 'x' }));
  await assert.rejects(sendVeloxaPasswordReset('invalid-email'));
  assert.throws(() => signInQuickRoleSession('admin'));
});

test('workspace identifiers retain the full UID and do not collapse distinct customers', () => {
  assert.notEqual(buildWorkspaceIdForUid('abcdefghijklmnop123'), buildWorkspaceIdForUid('abcdefghijklmnop456'));
  assert.notEqual(buildWorkspaceIdForUid('a-b'), buildWorkspaceIdForUid('ab'));
  assert.equal(buildWorkspaceIdForUid('a/b').includes('/'), false);
});

test('editing onboarding preserves stored customer work and never merges a foreign workspace', () => {
  const previous = buildRealInitialWorkspaceSnapshot({ workspaceId: 'workspace-a', businessName: 'Old name', city: 'Jakarta', category: 'custom', planId: 'free_trial' });
  previous.brand.whatsappNumber = '628123456789';
  previous.brand.primaryColorHex = '#123456';
  previous.drafts = [generateBrandContentDraft({ brand: previous.brand, format: 'single_post', source: 'manual_studio', vaultAssets: [], connections: [], planId: 'free_trial' })];
  const fresh = buildRealInitialWorkspaceSnapshot({ workspaceId: 'workspace-a', businessName: 'New name', city: 'Bandung', category: 'custom', planId: 'free_trial' });
  const merged = mergeOnboardingSnapshot(previous, fresh);
  assert.equal(merged.brand.businessName, 'New name'); assert.equal(merged.brand.whatsappNumber, '628123456789');
  assert.equal(merged.brand.primaryColorHex, '#123456'); assert.deepEqual(merged.drafts, previous.drafts);
  const foreign = { ...fresh, brand: { ...fresh.brand, workspaceId: 'workspace-b' } };
  assert.deepEqual(mergeOnboardingSnapshot(previous, foreign), foreign);
});

test('budget guards reject zero/low daily caps and totals above the monthly cap', () => {
  assert.throws(() => campaign({ dailyHardCapIdr: 0 }));
  assert.throws(() => campaign({ dailyHardCapIdr: 10_000 }));
  assert.throws(() => campaign({ monthlyHardCapIdr: 30_000 }));
  assert.throws(() => campaign({ dailyHardCapIdr: NaN }));
  assert.equal(campaign().budget.appliedDailyBudgetIdr, 100_000);
});

test('quality gate reports unfinished repairs and treats forbidden words as literals', () => {
  const brand = BRAND_PRESETS.running_event;
  assert.equal(runAutonomousQualityRepairLoop({ title: 'Test', hook: '', caption: 'x', brand, maxAttempts: 1 }).review.passed, false);
  const result = runAutonomousQualityRepairLoop({ title: 'Test', hook: '[', caption: '[', brand: { ...brand, forbiddenWords: ['['] } });
  assert.equal(result.repairedCaption.includes('['), false);
  assert.equal(result.review.checkedAspects.typographyContrast, false);
});

test('new drafts have no remote posts and new campaign metrics are zero, not generated conversions', () => {
  const draft = generateBrandContentDraft({ brand: BRAND_PRESETS.running_event, format: 'single_post', source: 'manual_studio', vaultAssets: [], connections: [], planId: 'free_trial' });
  assert.equal(draft.status, 'approved');
  assert.equal(draft.publishedAtWib, undefined);
  assert.equal(draft.caption.includes('Topik fokus:'), false);
  assert.equal(draft.caption.includes('Visual dirancang'), false);
  const plan = campaign();
  assert.ok(plan.creatives.every(creative => creative.metrics.conversions === 0 && creative.metrics.spendIdr === 0));
  assert.deepEqual(runMetaAdsAutonomousOptimizer(plan), plan);
});

test('optimizer does not manufacture conversions and is idempotent without new insights', () => {
  const plan = campaign(); plan.status = 'active_running';
  plan.creatives[0].metrics.conversions = 10; plan.creatives[0].metrics.costPerResultIdr = 1000;
  plan.creatives[1].metrics.conversions = 2; plan.creatives[1].metrics.costPerResultIdr = 3000;
  const optimized = runMetaAdsAutonomousOptimizer(plan);
  assert.deepEqual(optimized.creatives.map(item => item.metrics.conversions), [10, 2]);
  assert.deepEqual(runMetaAdsAutonomousOptimizer(optimized), optimized);
});

test('invalid quota usage cannot pass the quota guard', () => {
  for (const usage of [NaN, Infinity, -1, 0.5]) assert.equal(canConsumePostingQuota({ planId: 'free_trial', postsPublishedThisMonth: usage }).allowed, false);
});

test('saving offline twice retains pending cloud changes', async () => {
  const values = new Map<string, string>();
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) } } });
  try {
    const cfg = { ...getDefaultFirebaseConnectionConfig(), projectId: '', apiKey: '' };
    const snapshot = buildRealInitialWorkspaceSnapshot({ workspaceId: 'offline-test', businessName: 'Test Brand', city: 'Jakarta', category: 'custom', planId: 'free_trial' });
    const first = await syncWorkspaceSnapshotToStore(snapshot, cfg);
    const second = await syncWorkspaceSnapshotToStore(snapshot, cfg);
    assert.equal(first.telemetry.dirtyPendingCloudSync, true);
    assert.equal(second.telemetry.dirtyPendingCloudSync, true);
    assert.equal(second.syncedToFirestore, false);
    assert.equal(calculateFirestoreCostSavingsPct({ ...second.telemetry, firestoreOpsSaved: 0, firestoreReads: 100, firestoreWrites: 0 }), 0);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
