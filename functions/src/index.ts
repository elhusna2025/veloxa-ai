import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import {
  BRAND_PRESETS,
  SUBSCRIPTION_PLANS,
  buildMetaAdCampaignPlan,
  canConsumePostingQuota,
  extractStyleDnaFromReference,
  generateBrandContentDraft,
  runMetaAdsAutonomousOptimizer,
  searchValidatedMetaInterests,
  validateAutonomyScheduleAgainstPlan,
} from '../../src/lib/veloxa-engine';
import type {
  AutonomyConfig,
  BrandProfile,
  BrandVaultAsset,
  ChannelConnectionState,
  ContentFormat,
  MetaAdCampaignPlan,
  MetaAdObjective,
  MetaAdsAccountConnection,
  SubscriptionPlanId,
} from '../../src/lib/veloxa-types';

if (getApps().length === 0) {
  initializeApp();
}

const REGION = 'asia-southeast2';

function requireAuth(request: { auth?: { uid: string; token?: Record<string, unknown> } }) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Silakan login ke Veloxa AI terlebih dahulu.');
  }
  return request.auth;
}

/**
 * 1. Save or update Brand Brain profile & Extract Style DNA for Vault references
 */
export const saveVeloxaBrandProfile = onCall({ region: REGION, memory: '512MiB' }, async (request) => {
  requireAuth(request);
  const profile = request.data?.profile as BrandProfile | undefined;
  if (!profile?.workspaceId || !profile?.businessName) {
    throw new HttpsError('invalid-argument', 'Profil Brand Brain wajib memuat workspaceId dan nama bisnis.');
  }
  const db = getFirestore();
  await db
    .collection('workspaces')
    .doc(profile.workspaceId)
    .collection('brand_brain')
    .doc('current')
    .set({ ...profile, updatedAt: new Date().toISOString() }, { merge: true });
  return { success: true, workspaceId: profile.workspaceId };
});

/**
 * 2. Upload Reference Style or Real User Asset into Brand Vault
 */
export const registerVeloxaVaultAsset = onCall({ region: REGION, memory: '512MiB' }, async (request) => {
  requireAuth(request);
  const asset = request.data?.asset as BrandVaultAsset | undefined;
  const category = (request.data?.category || 'custom') as BrandProfile['category'];
  if (!asset?.workspaceId || !asset?.id) {
    throw new HttpsError('invalid-argument', 'Data aset Brand Vault belum lengkap.');
  }
  const enriched: BrandVaultAsset =
    asset.drawer === 'style_reference'
      ? {
          ...asset,
          extractedStyleDna: extractStyleDnaFromReference({
            title: asset.title,
            description: asset.description,
            mediaType: asset.mediaType,
            category,
          }),
        }
      : asset;

  const db = getFirestore();
  await db
    .collection('workspaces')
    .doc(asset.workspaceId)
    .collection('vault_assets')
    .doc(asset.id)
    .set(enriched, { merge: true });

  return { success: true, asset: enriched };
});

/**
 * 3. Studio Konten & Autonomous Content Generator (Multi-Platform: IG, FB, TikTok, YouTube Shorts)
 */
export const generateVeloxaStudioDraft = onCall(
  { region: REGION, memory: '1GiB', timeoutSeconds: 300 },
  async (request) => {
    requireAuth(request);
    const {
      brand,
      format,
      customTopic,
      vaultAssets = [],
      connections = [],
      planId = 'pro_1500k',
      postsPublishedThisMonth = 0,
    } = request.data as {
      brand: BrandProfile;
      format: ContentFormat;
      customTopic?: string;
      vaultAssets: BrandVaultAsset[];
      connections: ChannelConnectionState[];
      planId: SubscriptionPlanId;
      postsPublishedThisMonth: number;
    };

    const quotaCheck = canConsumePostingQuota({ planId, postsPublishedThisMonth });
    if (!quotaCheck.allowed) {
      throw new HttpsError('resource-exhausted', quotaCheck.reason || 'Kuota bulanan habis.');
    }

    const draft = generateBrandContentDraft({
      brand: brand || BRAND_PRESETS.running_event,
      format: format || 'short_video',
      source: 'manual_studio',
      customTopic,
      vaultAssets,
      connections,
      planId,
    });

    const db = getFirestore();
    await db
      .collection('workspaces')
      .doc(draft.workspaceId)
      .collection('drafts')
      .doc(draft.id)
      .set(draft);

    return { success: true, draft };
  },
);

/**
 * 4. Update Flexible Autonomous Schedule (1x–4x/day, custom WIB times, Co-Pilot vs Full Autonomous)
 */
export const updateVeloxaAutonomyConfig = onCall({ region: REGION, memory: '512MiB' }, async (request) => {
  requireAuth(request);
  const { config, planId = 'pro_1500k' } = request.data as {
    config: AutonomyConfig;
    planId: SubscriptionPlanId;
  };
  if (!config?.workspaceId) {
    throw new HttpsError('invalid-argument', 'workspaceId wajib diisi.');
  }

  const validation = validateAutonomyScheduleAgainstPlan(config, planId);
  const normalized: AutonomyConfig = {
    ...config,
    postsPerDay: validation.clampedPostsPerDay,
    targetChannels: validation.allowedTargetChannels,
  };

  const db = getFirestore();
  await db
    .collection('workspaces')
    .doc(config.workspaceId)
    .collection('autonomy_slots')
    .doc('config')
    .set(normalized, { merge: true });

  return { success: true, config: normalized, notice: validation.notice };
});

/**
 * 5. AI Agent Marketing — Meta Ads Architect (Demographics, Validated Interests, Budget & Hard Cap)
 */
export const designVeloxaMetaAdCampaign = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 180 },
  async (request) => {
    requireAuth(request);
    const {
      brand,
      metaAccount,
      objective,
      promotedOfferingTitle,
      requestedDailyBudgetIdr,
      durationDays,
      targetCity,
      radiusKm,
      ageMin,
      ageMax,
      customInterestKeyword,
      planId = 'pro_1500k',
    } = request.data as {
      brand: BrandProfile;
      metaAccount: MetaAdsAccountConnection;
      objective: MetaAdObjective;
      promotedOfferingTitle: string;
      requestedDailyBudgetIdr: number;
      durationDays: number;
      targetCity?: string;
      radiusKm?: number;
      ageMin?: number;
      ageMax?: number;
      customInterestKeyword?: string;
      planId?: SubscriptionPlanId;
    };

    if (!SUBSCRIPTION_PLANS[planId]?.includesMetaAdsAgent) {
      throw new HttpsError(
        'permission-denied',
        'Fitur AI Agent Marketing Meta Ads tersedia pada paket Veloxa Pro (Rp1.500.000/bulan).',
      );
    }

    const plan = buildMetaAdCampaignPlan({
      brand: brand || BRAND_PRESETS.running_event,
      metaAccount,
      objective,
      promotedOfferingTitle,
      requestedDailyBudgetIdr,
      durationDays,
      targetCity,
      radiusKm,
      ageMin,
      ageMax,
      customInterestKeyword,
    });

    const db = getFirestore();
    await db
      .collection('workspaces')
      .doc(plan.workspaceId)
      .collection('meta_ad_campaigns')
      .doc(plan.id)
      .set(plan);

    return {
      success: true,
      campaignPlan: plan,
      validatedInterests: searchValidatedMetaInterests(brand.category, customInterestKeyword),
    };
  },
);

/**
 * 6. Scheduled 24/7 Autonomous Content & Meta Ads Media Buyer Worker
 */
export const processVeloxaAutonomousEngine = onSchedule(
  {
    region: REGION,
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Jakarta',
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async () => {
    const db = getFirestore();
    const workspacesSnap = await db.collection('workspaces').where('subscriptionStatus', '==', 'active').limit(50).get();

    for (const wsDoc of workspacesSnap.docs) {
      const campaignsSnap = await wsDoc.ref
        .collection('meta_ad_campaigns')
        .where('status', '==', 'active_running')
        .limit(10)
        .get();

      for (const campDoc of campaignsSnap.docs) {
        const current = campDoc.data() as MetaAdCampaignPlan;
        const optimized = runMetaAdsAutonomousOptimizer(current);
        if (optimized.optimizationLogs.length !== current.optimizationLogs.length) {
          await campDoc.ref.set(optimized, { merge: true });
        }
      }
    }
  },
);
