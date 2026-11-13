import { hasWorkspaceAccess, isVerifiedAdmin } from '../../src/lib/veloxa-workspace-policy';
import { effectiveWorkspacePlan } from '../../src/lib/subscription';
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
  const provider = request.auth?.token?.firebase as { sign_in_provider?: string } | undefined;
  if (!request.auth?.uid || provider?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'Silakan login ke Veloxa AI terlebih dahulu.');
  }
  return request.auth;
}

async function requireWorkspaceAccess(request: { auth?: { uid: string; token?: Record<string, unknown> } }, workspaceId: unknown) {
  const actor = requireAuth(request);
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 512 || workspaceId.includes('/')) throw new HttpsError('invalid-argument', 'workspaceId tidak valid.');
  const snapshot = await getFirestore().collection('workspaces').doc(workspaceId).get();
  const workspace = snapshot.data();
  if (!workspace || !hasWorkspaceAccess(actor.uid, workspace, isVerifiedAdmin(actor.token || {}))) throw new HttpsError('permission-denied', 'Anda tidak memiliki akses ke workspace ini.');
  return workspace;
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
  await requireWorkspaceAccess(request, profile.workspaceId);
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
  await requireWorkspaceAccess(request, asset.workspaceId);
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
      planId: _clientPlan,
      postsPublishedThisMonth: _clientUsage,
    } = request.data as {
      brand: BrandProfile;
      format: ContentFormat;
      customTopic?: string;
      vaultAssets: BrandVaultAsset[];
      connections: ChannelConnectionState[];
      planId: SubscriptionPlanId;
      postsPublishedThisMonth: number;
    };

    const workspace = await requireWorkspaceAccess(request, brand?.workspaceId);
    const planId = effectiveWorkspacePlan(workspace);
    const postsPublishedThisMonth = Number(workspace.quotaUsed || 0);
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
  const { config, planId: _clientPlan } = request.data as {
    config: AutonomyConfig;
    planId: SubscriptionPlanId;
  };
  if (!config?.workspaceId) {
    throw new HttpsError('invalid-argument', 'workspaceId wajib diisi.');
  }

  const workspace = await requireWorkspaceAccess(request, config.workspaceId);
  const planId = effectiveWorkspacePlan(workspace);
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
      planId: _clientPlan,
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

    const workspace = await requireWorkspaceAccess(request, brand?.workspaceId);
    const planId = effectiveWorkspacePlan(workspace);
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
    // Live ads execution/optimization is intentionally disabled until a verified provider adapter exists.
    // Organic image publishing is handled by the authenticated Veloxa server.
    return;
  },
);
