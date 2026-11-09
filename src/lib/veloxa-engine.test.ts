import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAND_PRESETS,
  SUBSCRIPTION_PLANS,
  buildMetaAdCampaignPlan,
  calculatePlatformAdminMetrics,
  calculateTenantUnitEconomics,
  canConsumePostingQuota,
  computeEventCampaignPhase,
  extractStyleDnaFromReference,
  generateBrandContentDraft,
  resolveTargetChannelsForFormat,
  runAutonomousQualityRepairLoop,
  runMetaAdsAutonomousOptimizer,
  searchValidatedMetaInterests,
  validateAutonomyScheduleAgainstPlan,
} from './veloxa-engine';
import {
  VELOXA_OPENAI_AGENTS,
  runContentCreatorAndCriticAgent,
  runStyleDnaVisionAgent,
} from './veloxa-openai-agents';
import {
  executeMetaAdsCampaignOnGraphApi,
  publishDraftToConnectedChannels,
} from './veloxa-social-publisher';
import {
  calculateFirestoreCostSavingsPct,
  computePayloadFingerprint,
} from './veloxa-local-first';
import { buildRenderedVisualSvg } from './veloxa-visual-renderer';
import { resolveRoleFromEmail } from './veloxa-auth';
import type { ChannelConnectionState, MetaAdsAccountConnection } from './veloxa-types';

const ALL_CONNECTED_CHANNELS: ChannelConnectionState[] = [
  {
    channel: 'instagram',
    connected: true,
    handle: '@nusantararun.id',
    accountName: 'Nusantara Run Festival',
    followerCount: 28400,
    oauthMode: 'direct_publish',
    tokenExpiresAt: '2027-01-15T00:00:00Z',
    lastPublishedAt: 'Hari ini, 07:00 WIB',
  },
  {
    channel: 'facebook',
    connected: true,
    handle: 'Nusantara Run Official',
    accountName: 'Nusantara Run Page',
    followerCount: 14200,
    oauthMode: 'direct_publish',
    tokenExpiresAt: '2027-01-15T00:00:00Z',
    lastPublishedAt: 'Hari ini, 07:00 WIB',
  },
  {
    channel: 'tiktok',
    connected: true,
    handle: '@nusantararun',
    accountName: 'Nusantara Run TikTok',
    followerCount: 41900,
    oauthMode: 'direct_publish',
    tokenExpiresAt: '2027-01-15T00:00:00Z',
    lastPublishedAt: 'Hari ini, 07:00 WIB',
  },
  {
    channel: 'youtube_shorts',
    connected: true,
    handle: '@NusantaraRunTV',
    accountName: 'Nusantara Run Shorts',
    followerCount: 9800,
    oauthMode: 'direct_publish',
    tokenExpiresAt: '2027-01-15T00:00:00Z',
    lastPublishedAt: 'Kemarin, 19:00 WIB',
  },
];

test('resolveTargetChannelsForFormat limits published formats to Instagram and Facebook even on Pro', () => {
  const videoTargets = resolveTargetChannelsForFormat('short_video', ALL_CONNECTED_CHANNELS, 'pro_1500k');
  assert.deepEqual(videoTargets, ['instagram', 'facebook']);

  const carouselTargets = resolveTargetChannelsForFormat('carousel', ALL_CONNECTED_CHANNELS, 'pro_1500k');
  assert.deepEqual(carouselTargets, ['instagram', 'facebook']);
  assert.deepEqual(resolveTargetChannelsForFormat('single_post', ALL_CONNECTED_CHANNELS, 'pro_1500k'), ['instagram', 'facebook']);

  const starterTargets = resolveTargetChannelsForFormat('short_video', ALL_CONNECTED_CHANNELS, 'starter_500k');
  assert.deepEqual(starterTargets, ['instagram', 'facebook']);
});

test('runAutonomousQualityRepairLoop removes forbidden words and reaches passed status with 0 issues', () => {
  const cafeBrand = BRAND_PRESETS.cafe_fnb;
  const result = runAutonomousQualityRepairLoop({
    title: 'Kopi Sore',
    hook: 'Kopi instan buat sore',
    caption: 'Rasanya tidak murahan dan cocok buat WFC.',
    brand: cafeBrand,
  });

  assert.equal(result.review.passed, true);
  assert.equal(result.review.issues.length, 0);
  assert.ok(result.review.score >= 90);
  assert.equal(result.repairedHook.toLowerCase().includes('instan'), false);
  assert.equal(result.repairedCaption.toLowerCase().includes('murahan'), false);
  assert.ok(result.repairedCaption.includes('Kopi Senja'));
});

test('generateBrandContentDraft integrates user real assets and style reference DNA', () => {
  const runBrand = BRAND_PRESETS.running_event;
  const draft = generateBrandContentDraft({
    brand: runBrand,
    format: 'short_video',
    source: 'autonomous_agent',
    vaultAssets: [
      {
        id: 'ref_1',
        workspaceId: runBrand.workspaceId,
        drawer: 'style_reference',
        mediaType: 'video_reel',
        title: 'Contoh Reels Marathon Energetik',
        description: 'Transisi cepat pelari saat matahari terbit',
        previewUrl: '/demo/reel-ref.jpg',
        aspectRatio: '9:16',
        tags: ['marathon', 'reels'],
        uploadedFrom: 'ios',
        createdAt: '2026-11-01',
        usedInPostsCount: 4,
        extractedStyleDna: extractStyleDnaFromReference({
          title: 'Contoh Reels Marathon',
          description: 'Fast cut',
          mediaType: 'video_reel',
          category: 'running_event',
        }),
      },
      {
        id: 'real_1',
        workspaceId: runBrand.workspaceId,
        drawer: 'real_asset',
        mediaType: 'photo',
        title: 'Foto Pelari Finisher & Medali Bandung 10K',
        description: 'Dokumentasi asli pelari memegang medali',
        previewUrl: '/demo/real-runner.jpg',
        aspectRatio: '9:16',
        tags: ['medali', 'pelari'],
        uploadedFrom: 'android',
        createdAt: '2026-11-01',
        usedInPostsCount: 2,
      },
    ],
    connections: ALL_CONNECTED_CHANNELS,
    planId: 'pro_1500k',
  });

  assert.equal(draft.format, 'short_video');
  assert.equal(draft.usedStyleReferenceId, 'ref_1');
  assert.deepEqual(draft.usedRealAssetIds, ['real_1']);
  assert.equal(draft.videoScenes?.length, 4);
  assert.equal(draft.qualityReview.passed, true);
});

test('computeEventCampaignPhase calculates accurate countdown phases', () => {
  const earlyBird = computeEventCampaignPhase('2026-11-22T00:00:00Z', '2026-11-02T00:00:00Z');
  assert.equal(earlyBird.phase, 'early_bird_launch');
  assert.equal(earlyBird.daysUntilEvent, 20);

  const urgency = computeEventCampaignPhase('2026-11-05T00:00:00Z', '2026-11-02T00:00:00Z');
  assert.equal(urgency.phase, 'countdown_urgency');
});

test('buildMetaAdCampaignPlan enforces Hard Budget Cap and runMetaAdsAutonomousOptimizer scales winning variant', () => {
  const metaAccount: MetaAdsAccountConnection = {
    connected: true,
    adAccountId: 'act_889900112233',
    adAccountName: 'Nusantara Run Ads Manager',
    businessPortfolioName: 'PT Nusantara Sportainment',
    currency: 'IDR',
    paymentMethodLabel: 'Visa Corporate •• 4821',
    dailyHardCapIdr: 200_000,
    monthlyHardCapIdr: 5_000_000,
    autoOptimizeEnabled: true,
    autoBoostOrganicWinners: true,
  };

  const plan = buildMetaAdCampaignPlan({
    brand: BRAND_PRESETS.running_event,
    metaAccount,
    objective: 'WEBSITE_CONVERSIONS',
    promotedOfferingTitle: 'Bandung Sunrise Run 10K Early Bird',
    requestedDailyBudgetIdr: 350_000, // Exceeds 200k hard cap!
    durationDays: 10,
    targetCity: 'Bandung',
    radiusKm: 25,
    customInterestKeyword: 'Half Marathon',
  });

  // Hard cap must clamp 350k down to 200k!
  assert.equal(plan.budget.hardCapClamped, true);
  assert.equal(plan.budget.appliedDailyBudgetIdr, 200_000);
  assert.equal(plan.budget.totalBudgetIdr, 2_000_000);
  assert.ok(plan.validatedInterests.some((i) => i.name.includes('Half Marathon')));
  assert.equal(plan.optimizationLogs.length, 1);
  assert.equal(plan.optimizationLogs[0].actionType, 'cap_guard_enforced');

  // Only actual running campaigns with observed conversion metrics may be optimized.
  assert.deepEqual(runMetaAdsAutonomousOptimizer(plan), plan);
  plan.status = 'active_running';
  plan.creatives[0].metrics.conversions = 20;
  plan.creatives[0].metrics.costPerResultIdr = 1000;
  plan.creatives[1].metrics.conversions = 2;
  plan.creatives[1].metrics.costPerResultIdr = 2500;
  const optimized = runMetaAdsAutonomousOptimizer(plan);
  assert.equal(optimized.status, 'active_running');
  const winner = optimized.creatives.find((c) => c.status === 'winner_scaled');
  const loser = optimized.creatives.find((c) => c.status === 'paused_by_ai_loser');
  assert.ok(winner);
  assert.ok(loser);
  assert.equal(winner.budgetSharePct, 100);
  assert.equal(loser.budgetSharePct, 0);
});

test('calculateTenantUnitEconomics and quota guards protect SaaS gross margins across 500k–1.5M plans', () => {
  const proEcon = calculateTenantUnitEconomics({
    planId: 'pro_1500k',
    postsPublishedThisMonth: 60,
    realAssetRatioPct: 50,
  });
  assert.equal(proEcon.monthlyRevenueIdr, 1_500_000);
  assert.ok(proEcon.grossMarginPct >= 75);

  const exhausted = canConsumePostingQuota({
    planId: 'starter_500k',
    postsPublishedThisMonth: SUBSCRIPTION_PLANS.starter_500k.monthlyPostQuota,
  });
  assert.equal(exhausted.allowed, false);

  const scheduleValidation = validateAutonomyScheduleAgainstPlan(
    { postsPerDay: 3, targetChannels: ['instagram', 'tiktok', 'youtube_shorts'] },
    'starter_500k',
  );
  assert.equal(scheduleValidation.valid, false);
  assert.equal(scheduleValidation.clampedPostsPerDay, 1);
  assert.deepEqual(scheduleValidation.allowedTargetChannels, ['instagram']);

  const adminSummary = calculatePlatformAdminMetrics([
    {
      workspaceId: 'ws_1',
      businessName: 'Kopi Senja',
      ownerName: 'Raka',
      ownerEmail: 'raka@kopisenja.id',
      category: 'cafe_fnb',
      planId: 'growth_1000k',
      subscriptionStatus: 'active',
      postsPublishedThisMonth: 30,
      monthlyPostQuota: 45,
      connectedChannels: ['instagram', 'facebook', 'tiktok', 'youtube_shorts'],
      metaAdsConnected: false,
      activeMetaCampaigns: 0,
      monthlySubscriptionRevenueIdr: 1_000_000,
      estimatedMonthlyApiCostIdr: 120_000,
      grossMarginPct: 88,
    },
  ]);
  assert.equal(adminSummary.totalMrrIdr, 1_000_000);
  assert.equal(adminSummary.averageGrossMarginPct, 88);
});

test('agent definitions and local drafts do not fabricate publishing receipts', async () => {
  assert.equal(Object.keys(VELOXA_OPENAI_AGENTS).length, 5);
  assert.equal(VELOXA_OPENAI_AGENTS.styleDnaVision.agentId, 'agt_veloxa_style_dna_vision_v1');
  assert.equal(VELOXA_OPENAI_AGENTS.metaAdsArchitect.agentId, 'agt_veloxa_meta_ads_architect_v1');

  const visionRes = await runStyleDnaVisionAgent({
    title: 'Poster Event Lari 10K',
    description: 'High contrast dynamic runner',
    mediaType: 'photo',
    category: 'running_event',
  });
  assert.ok(visionRes.styleDna.layoutPattern.length > 5);

  const creatorRes = await runContentCreatorAndCriticAgent({
    brand: BRAND_PRESETS.running_event,
    format: 'short_video',
    source: 'manual_studio',
    vaultAssets: [],
    connections: ALL_CONNECTED_CHANNELS,
    planId: 'pro_1500k',
  });
  assert.equal(creatorRes.draft.qualityReview.passed, true);
  assert.equal(creatorRes.draft.targetChannels.length, 2);

  await assert.rejects(publishDraftToConnectedChannels({ draft: creatorRes.draft }), /endpoint server/);
  assert.ok(creatorRes.draft.channelStatuses.every(channel => channel.status === 'pending' && !channel.permalink));

  const metaPlan = buildMetaAdCampaignPlan({
    brand: BRAND_PRESETS.running_event,
    metaAccount: {
      connected: true,
      adAccountId: 'act_889900112233',
      adAccountName: 'Nusantara Run Ads Manager',
      businessPortfolioName: 'PT Nusantara Sportainment',
      currency: 'IDR',
      paymentMethodLabel: 'Visa Corporate •• 4821',
      dailyHardCapIdr: 250_000,
      monthlyHardCapIdr: 5_000_000,
      autoOptimizeEnabled: true,
      autoBoostOrganicWinners: true,
    },
    objective: 'WHATSAPP_MESSAGES',
    promotedOfferingTitle: 'Bandung Sunrise Run 10K',
    requestedDailyBudgetIdr: 150_000,
    durationDays: 7,
  });

  await assert.rejects(executeMetaAdsCampaignOnGraphApi({ campaign: metaPlan, adAccountId: 'act_889900112233', targetStatus: 'ACTIVE' }), /belum diaktifkan/);
});

test('Local-First Cost Guard FNV-1a fingerprinting and Visual Poster SVG Renderer work deterministically', () => {
  const hashA = computePayloadFingerprint({ a: 1, b: 'veloxa' });
  const hashB = computePayloadFingerprint({ a: 1, b: 'veloxa' });
  const hashC = computePayloadFingerprint({ a: 2, b: 'veloxa' });
  assert.equal(hashA, hashB);
  assert.notEqual(hashA, hashC);
  assert.ok(hashA.startsWith('fnv1a_'));

  const savingsPct = calculateFirestoreCostSavingsPct({
    localReads: 12,
    localWrites: 18,
    firestoreReads: 1,
    firestoreWrites: 1,
    firestoreOpsSaved: 28,
    lastLocalSaveWib: 'Baru saja',
    lastCloudSyncWib: 'Baru saja',
    lastPayloadHash: hashA,
    dirtyPendingCloudSync: false,
  });
  assert.ok(savingsPct >= 90);

  const sampleDraft = generateBrandContentDraft({
    brand: BRAND_PRESETS.running_event,
    format: 'carousel',
    source: 'manual_studio',
    vaultAssets: [],
    connections: ALL_CONNECTED_CHANNELS,
    planId: 'pro_1500k',
  });
  const svg = buildRenderedVisualSvg({
    brand: BRAND_PRESETS.running_event,
    draft: sampleDraft,
    slideIndex: 0,
  });
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('#EC749B'));
  assert.ok(svg.includes('Nusantara Run Festival'));
  assert.equal(resolveRoleFromEmail('sosrospg@gmail.com'), 'admin');
  assert.equal(resolveRoleFromEmail('owner@kopisenja.id'), 'user');
});

test('Global Multi-Language (i18n) and Multi-Currency Pricing support all 6 global markets', async () => {
  const { VELOXA_I18N_COPY, VELOXA_LOCALES, getPlanLocalizedPrice } = await import('./veloxa-i18n');
  assert.equal(VELOXA_LOCALES.length, 6);
  for (const loc of VELOXA_LOCALES) {
    assert.ok(VELOXA_I18N_COPY[loc.code].heroBadge.length > 5);
    assert.ok(VELOXA_I18N_COPY[loc.code].galleryTitle.length > 5);
  }
  assert.equal(getPlanLocalizedPrice('starter_500k', 'id').amountFormatted, 'Rp500.000');
  assert.equal(getPlanLocalizedPrice('starter_500k', 'en').amountFormatted, '$35');
  assert.equal(getPlanLocalizedPrice('pro_1500k', 'ja').amountFormatted, '¥15,500');
  assert.equal(getPlanLocalizedPrice('pro_1500k', 'ko').amountFormatted, '₩139,000');
});


