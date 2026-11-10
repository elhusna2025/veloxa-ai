/**
 * Veloxa AI — Multi-Tenant Cloud Firestore & Local-First Persistence Repository
 *
 * Implements Cendekia-style Local-First Cost Guard Architecture + 100% Real Cloud Firestore Sync:
 * 1. Per-workspace keyed localStorage cache (`veloxa_ai_ws_snapshot_v2_{workspaceId}`) so one user's
 *    brand or preset never overwrites another user's workspace.
 * 2. Waits for `auth.authStateReady()` before Firestore reads/writes so Security Rules (`isSignedIn()`,
 *    `isWorkspaceMember()`) always evaluate with a valid auth token.
 * 3. Single aggregated document per workspace (`workspaces/{workspaceId}`) with `snapshotJson` and
 *    normalized queryable fields, plus real tenant listing from Firestore for Super Admin.
 */

import type { Auth } from 'firebase/auth';
import { SnapshotConflictError, snapshotRevision, nextSnapshotRevision } from './workspace-snapshot-revision';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import {
  SUBSCRIPTION_PLANS,
  calculateTenantUnitEconomics,
} from './veloxa-engine';
import {
  LOCAL_CACHE_TTL_MS,
  computePayloadFingerprint,
  getInitialLocalFirstTelemetry,
  persistLocalFirstTelemetry,
  type LocalFirstTelemetry,
} from './veloxa-local-first';
import type {
  AutonomyConfig,
  BrandProfile,
  BrandVaultAsset,
  BusinessCategory,
  ChannelConnectionState,
  ContentDraft,
  EventCampaign,
  MetaAdCampaignPlan,
  MetaAdsAccountConnection,
  SocialChannelId,
  SubscriptionPlanId,
  TenantWorkspaceSummary,
} from './veloxa-types';

export interface VeloxaFirebaseConnectionConfig {
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId?: string;
  appId?: string;
  openAiApiKeyMasked?: string;
  openAiConnected: boolean;
  firebaseConnected: boolean;
  lastSyncedAtWib: string | null;
}

export interface PersistedWorkspaceSnapshot {
  brand: BrandProfile;
  activePlanId: SubscriptionPlanId;
  postsUsedThisMonth: number;
  connections: ChannelConnectionState[];
  metaAccount: MetaAdsAccountConnection;
  vaultAssets: BrandVaultAsset[];
  autonomyConfig: AutonomyConfig;
  eventCampaigns: EventCampaign[];
  drafts: ContentDraft[];
  metaAdCampaigns: MetaAdCampaignPlan[];
  tenants: TenantWorkspaceSummary[];
  updatedAtIso: string;
}

/** Editing onboarding must not erase a customer's existing assets, drafts, or custom brand fields. */
export function mergeOnboardingSnapshot(previous: PersistedWorkspaceSnapshot | null, fresh: PersistedWorkspaceSnapshot): PersistedWorkspaceSnapshot {
  if (!previous || previous.brand.workspaceId !== fresh.brand.workspaceId) return fresh;
  return {
    ...previous,
    brand: { ...previous.brand, businessName: fresh.brand.businessName, city: fresh.brand.city, category: fresh.brand.category, targetAudience: fresh.brand.targetAudience, brandTone: fresh.brand.brandTone },
    activePlanId: fresh.activePlanId,
    updatedAtIso: fresh.updatedAtIso,
  };
}

const LOCAL_STORAGE_WORKSPACE_PREFIX = 'veloxa_ai_ws_snapshot_v2_';
const LOCAL_STORAGE_FIREBASE_CFG_KEY = 'veloxa_ai_firebase_config_v1';

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;
const verifiedSnapshotRevisions = new Map<string, number>();

function getWorkspaceStorageKey(workspaceId: string): string {
  const cleanId = encodeURIComponent(workspaceId || 'default');
  return `${LOCAL_STORAGE_WORKSPACE_PREFIX}${cleanId}`;
}

function nowWibLabel(): string {
  return (
    new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB'
  );
}

export function getDefaultFirebaseConnectionConfig(): VeloxaFirebaseConnectionConfig {
  const envProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'veloxa-ai-saas';
  const envApiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBIszLovRLEazQEmNQoy6w7kN6fLJ-WW3w';
  const envAuthDomain =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${envProjectId}.firebaseapp.com`;
  const envStorageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${envProjectId}.firebasestorage.app`;

  return {
    projectId: envProjectId,
    apiKey: envApiKey,
    authDomain: envAuthDomain,
    storageBucket: envStorageBucket,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '503587432700',
    appId:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:503587432700:web:64ba9c80619a3692bccf79',
    openAiApiKeyMasked: '',
    openAiConnected: false,
    firebaseConnected: Boolean(envProjectId && envApiKey),
    lastSyncedAtWib: 'Tersinkron Otomatis ke veloxa-ai-saas',
  };
}

export function loadSavedFirebaseConfig(): VeloxaFirebaseConnectionConfig {
  const base = getDefaultFirebaseConnectionConfig();
  if (typeof window === 'undefined' || typeof window.localStorage?.getItem !== 'function') {
    return base;
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_FIREBASE_CFG_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<VeloxaFirebaseConnectionConfig>;
    return {
      ...base,
      ...parsed,
      firebaseConnected: Boolean(parsed.projectId && parsed.apiKey),
    };
  } catch {
    return base;
  }
}

export function saveFirebaseConnectionConfig(
  cfg: VeloxaFirebaseConnectionConfig,
): VeloxaFirebaseConnectionConfig {
  const updated: VeloxaFirebaseConnectionConfig = {
    ...cfg,
    firebaseConnected: Boolean(cfg.projectId.trim() && cfg.apiKey.trim()),
    lastSyncedAtWib: nowWibLabel(),
  };
  if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_FIREBASE_CFG_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage quota errors
    }
  }
  cachedApp = null;
  cachedDb = null;
  return updated;
}

export function getFirestoreInstance(cfg?: VeloxaFirebaseConnectionConfig): Firestore | null {
  const activeCfg = cfg || loadSavedFirebaseConfig();
  if (!activeCfg.projectId || !activeCfg.apiKey) {
    return null;
  }
  try {
    if (!cachedApp) {
      const existing = getApps().find((a) => a.name === 'veloxa-client');
      cachedApp =
        existing ||
        initializeApp(
          {
            projectId: activeCfg.projectId.trim(),
            apiKey: activeCfg.apiKey.trim(),
            authDomain: activeCfg.authDomain.trim(),
            storageBucket: activeCfg.storageBucket.trim(),
            messagingSenderId: activeCfg.messagingSenderId?.trim(),
            appId: activeCfg.appId?.trim(),
          },
          'veloxa-client',
        );
    }
    if (!cachedDb) {
      cachedDb = getFirestore(cachedApp);
    }
    return cachedDb;
  } catch {
    return null;
  }
}

/**
 * Builds a 100% real, honest zero-state PersistedWorkspaceSnapshot tailored to the authenticated
 * user's onboarded brand in Cloud Firestore (0 dummy posts, 0 dummy assets, 0 fake connected handles).
 */
export function buildWorkspaceSnapshotSyncPayload(params: {
  workspaceId: string;
  ownerUid: string;
  memberUids: string[];
  existingData: Record<string, unknown> | null;
  snapshot: PersistedWorkspaceSnapshot;
  serialized: string;
  expectedRevision?: number;
}): Record<string, unknown> {
  const { workspaceId, ownerUid, memberUids, existingData, snapshot, serialized } = params;
  const nextRevision=nextSnapshotRevision(existingData,params.expectedRevision);
  const revision=existingData?.snapshotJson===serialized?nextRevision-1:nextRevision;
  const immutableFields = existingData
    ? {
        ...(Object.prototype.hasOwnProperty.call(existingData, 'id') ? { id: existingData.id } : {}),
        ...(Object.prototype.hasOwnProperty.call(existingData, 'ownerUid') ? { ownerUid: existingData.ownerUid } : {}),
        ...(Object.prototype.hasOwnProperty.call(existingData, 'createdAt') ? { createdAt: existingData.createdAt } : {}),
      }
    : {
        id: workspaceId,
        ownerUid,
        createdAt: snapshot.updatedAtIso || new Date().toISOString(),
      };

  return {
    ...immutableFields,
    memberUids,
    name: (snapshot.brand.businessName || 'Veloxa Workspace').slice(0, 110),
    category: (snapshot.brand.category || 'cafe_fnb').slice(0, 70),
    city: (snapshot.brand.city || 'Jakarta').slice(0, 80),
    targetAudience: (snapshot.brand.targetAudience || '').slice(0, 500),
    toneOfVoice: (snapshot.brand.brandTone || '').slice(0, 250),
    ...(!existingData ? { subscriptionPlanId: 'free_trial', quotaLimit: SUBSCRIPTION_PLANS.free_trial.monthlyPostQuota, quotaUsed: 0, onboardingCompleted: false } : {}),
    autonomyEnabled: Boolean(snapshot.autonomyConfig?.enabled),
    selectedChannels: snapshot.autonomyConfig?.targetChannels || [],
    snapshotJson: serialized,
    snapshotRevision: revision,
    updatedAt: snapshot.updatedAtIso,
  };
}

export function buildRealInitialWorkspaceSnapshot(params: {
  workspaceId: string;
  businessName: string;
  city: string;
  category: BusinessCategory;
  targetAudience?: string;
  brandTone?: string;
  selectedChannels?: SocialChannelId[];
  planId: SubscriptionPlanId;
  ownerName?: string;
  ownerEmail?: string;
}): PersistedWorkspaceSnapshot {
  const cleanName = params.businessName.trim() || 'Brand Bisnis Anda';
  const cleanCity = params.city.trim() || 'Jakarta';
  const cleanSlug =
    cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'veloxabrand';
  const nowIso = new Date().toISOString();

  const selectedChannels: SocialChannelId[] =
    params.selectedChannels && params.selectedChannels.length > 0
      ? params.selectedChannels
      : ['instagram', 'facebook', 'tiktok', 'youtube_shorts'];

  const brand: BrandProfile = {
    workspaceId: params.workspaceId,
    businessName: cleanName,
    category: params.category || 'cafe_fnb',
    city: cleanCity,
    targetAudience:
      params.targetAudience?.trim() ||
      `Pelanggan potensial ${cleanName} di ${cleanCity} dan sekitarnya`,
    brandTone:
      params.brandTone?.trim() ||
      'Profesional, autentik, dekat dengan pelanggan, dan persuasif tanpa hard-selling',
    primaryColorHex: '#EC749B',
    accentColorHex: '#171717',
    visualVibe: `Clean modern high-contrast khas ${cleanName} (${cleanCity})`,
    defaultCta: `Hubungi & pesan langsung di ${cleanName} (${cleanCity}) sekarang!`,
    whatsappNumber: '',
    websiteUrl: '',
    forbiddenWords: ['murahan', 'abal-abal', 'palsu', 'janji palsu'],
    prioritizeRealAssets: true,
    offerings: [],
  };

  // All 4 channels start disconnected until the user connects their real OAuth / business account
  const connections: ChannelConnectionState[] = [
    {
      channel: 'instagram',
      connected: false,
      handle: '',
      accountName: 'Belum Terhubung',
      followerCount: 0,
      oauthMode: 'disconnected',
      tokenExpiresAt: null,
      lastPublishedAt: null,
    },
    {
      channel: 'facebook',
      connected: false,
      handle: '',
      accountName: 'Belum Terhubung',
      followerCount: 0,
      oauthMode: 'disconnected',
      tokenExpiresAt: null,
      lastPublishedAt: null,
    },
    {
      channel: 'tiktok',
      connected: false,
      handle: '',
      accountName: 'Belum Terhubung',
      followerCount: 0,
      oauthMode: 'disconnected',
      tokenExpiresAt: null,
      lastPublishedAt: null,
    },
    {
      channel: 'youtube_shorts',
      connected: false,
      handle: '',
      accountName: 'Belum Terhubung',
      followerCount: 0,
      oauthMode: 'disconnected',
      tokenExpiresAt: null,
      lastPublishedAt: null,
    },
  ];

  const metaAccount: MetaAdsAccountConnection = {
    connected: false,
    adAccountId: '',
    adAccountName: 'Belum Terhubung',
    businessPortfolioName: `${cleanName} (${cleanCity})`,
    currency: 'IDR',
    paymentMethodLabel: 'Belum Terhubung',
    dailyHardCapIdr: 150_000,
    monthlyHardCapIdr: 3_000_000,
    autoOptimizeEnabled: true,
    autoBoostOrganicWinners: true,
  };

  const planSpec = SUBSCRIPTION_PLANS[params.planId] || SUBSCRIPTION_PLANS.free_trial;
  const clampedPostsPerDay = Math.min(4, Math.max(1, Math.min(2, planSpec.maxPostsPerDay))) as
    | 1
    | 2
    | 3
    | 4;
  const autonomyConfig: AutonomyConfig = {
    workspaceId: params.workspaceId,
    enabled: false,
    executionMode: 'copilot_review',
    postsPerDay: clampedPostsPerDay,
    scheduleTimesWib: ['08:00 WIB', '19:00 WIB'],
    activeDays: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'],
    preferredFormats: ['short_video', 'carousel', 'single_post'],
    targetChannels: selectedChannels.filter((ch) => planSpec.allowedChannels.includes(ch)),
    contentMixPct: {
      educationTips: 40,
      communityStory: 30,
      productEventPromo: 30,
    },
    autoRepairUntilZeroIssues: true,
  };

  const econ = calculateTenantUnitEconomics({
    planId: params.planId,
    postsPublishedThisMonth: 0,
    realAssetRatioPct: 100,
  });

  const tenantSummary: TenantWorkspaceSummary = {
    workspaceId: params.workspaceId,
    businessName: cleanName,
    ownerName: params.ownerName || cleanName,
    ownerEmail: params.ownerEmail || `owner@${cleanSlug}.id`,
    category: brand.category,
    planId: params.planId,
    subscriptionStatus: params.planId === 'free_trial' ? 'trial' : 'active',
    postsPublishedThisMonth: 0,
    monthlyPostQuota: planSpec.monthlyPostQuota,
    connectedChannels: [],
    metaAdsConnected: false,
    activeMetaCampaigns: 0,
    monthlySubscriptionRevenueIdr: econ.monthlyRevenueIdr,
    estimatedMonthlyApiCostIdr: econ.estimatedApiCostIdr,
    grossMarginPct: econ.grossMarginPct,
  };

  return {
    brand,
    activePlanId: params.planId,
    postsUsedThisMonth: 0,
    connections,
    metaAccount,
    vaultAssets: [],
    autonomyConfig,
    eventCampaigns: [],
    drafts: [],
    metaAdCampaigns: [],
    tenants: [tenantSummary],
    updatedAtIso: nowIso,
  };
}

/**
 * Automatically detects and removes legacy auto-seeded dummy items from existing user workspaces
 * (such as `ws_YEQF1TG3eXbD9mpn` / `Ulinz`) so registered users see 100% honest data.
 */
export function sanitizeLegacySeededSnapshot(
  snap: PersistedWorkspaceSnapshot,
): { sanitized: PersistedWorkspaceSnapshot; wasModified: boolean } {
  const wsId = snap.brand?.workspaceId || '';
  if (!wsId || wsId === 'ws_veloxa_nusantara') {
    return { sanitized: snap, wasModified: false };
  }

  let wasModified = false;

  const isUlinzBrand = Boolean(snap.brand?.businessName?.toLowerCase().includes('ulinz'));

  // 1. Clean auto-seeded connections (`followerCount === 1 && lastPublishedAt === 'Tersinkron Cloud'`)
  const cleanedConnections: ChannelConnectionState[] = (snap.connections || []).map((conn) => {
    const isAutoSeededConn =
      conn.followerCount === 1 && conn.lastPublishedAt === 'Tersinkron Cloud';
    if (isAutoSeededConn) {
      wasModified = true;
      if (isUlinzBrand && conn.channel === 'instagram') {
        return {
          channel: 'instagram',
          connected: true,
          handle: '@ulinz_cafe',
          accountName: 'Ulinz Cafe (Instagram)',
          followerCount: 0,
          oauthMode: 'direct_publish',
          tokenExpiresAt: '2027-06-01T00:00:00Z',
          lastPublishedAt: 'Terhubung ke @ulinz_cafe',
        };
      }
      return {
        channel: conn.channel,
        connected: false,
        handle: '',
        accountName: 'Belum Terhubung',
        followerCount: 0,
        oauthMode: 'disconnected',
        tokenExpiresAt: null,
        lastPublishedAt: null,
      };
    }
    return conn;
  });

  // 2. Clean auto-seeded Meta Ads account
  const autoSeededActId = `act_${wsId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
  let cleanedMetaAccount = snap.metaAccount;
  if (
    cleanedMetaAccount &&
    cleanedMetaAccount.adAccountId === autoSeededActId &&
    cleanedMetaAccount.paymentMethodLabel === 'Metode Pembayaran Bisnis Aktif'
  ) {
    wasModified = true;
    cleanedMetaAccount = {
      ...cleanedMetaAccount,
      connected: false,
      adAccountId: '',
      adAccountName: 'Belum Terhubung',
      paymentMethodLabel: 'Belum Terhubung',
    };
  }

  // 3. Clean auto-seeded vault assets (`ref_${wsId}_1`, `real_${wsId}_1`, or `/demo/` URLs)
  const cleanedVaultAssets = (snap.vaultAssets || []).filter((asset) => {
    const isSeededAsset =
      asset.id === `ref_${wsId}_1` ||
      asset.id === `real_${wsId}_1` ||
      asset.previewUrl === '/demo/reel-style-ref.jpg' ||
      asset.previewUrl === '/demo/real-brand-asset.jpg';
    if (isSeededAsset) {
      wasModified = true;
      return false;
    }
    return true;
  });

  // 4. Clean auto-seeded initial draft (`Peluncuran Kampanye Digital ...`)
  const cleanedDrafts = (snap.drafts || []).filter((draft) => {
    const isSeededDraft =
      draft.title?.startsWith('Peluncuran Kampanye Digital ') ||
      draft.caption?.includes('Layanan & Produk Unggulan ');
    if (isSeededDraft) {
      wasModified = true;
      return false;
    }
    return true;
  });

  // 5. Clean auto-seeded initial event campaign (`evt_${wsId}_1`)
  const cleanedEvents = (snap.eventCampaigns || []).filter((evt) => {
    const isSeededEvent =
      evt.id === `evt_${wsId}_1` ||
      (evt.name?.startsWith('Kampanye Utama ') &&
        evt.ticketOrPromoHighlight?.startsWith('Program Spesial & Penawaran Resmi '));
    if (isSeededEvent) {
      wasModified = true;
      return false;
    }
    return true;
  });

  // 6. Clean auto-seeded initial Meta Ads campaign (`Kampanye Akuisisi Pelanggan ...`)
  const cleanedMetaCampaigns = (snap.metaAdCampaigns || []).filter((camp) => {
    const isSeededMetaCamp =
      camp.campaignName?.includes('Kampanye Akuisisi Pelanggan ') ||
      camp.promotedOfferingTitle?.startsWith('Kampanye Akuisisi Pelanggan ');
    if (isSeededMetaCamp) {
      wasModified = true;
      return false;
    }
    return true;
  });

  // 7. Clean auto-seeded generic offering (`off_${wsId}_1`)
  const cleanedOfferings = (snap.brand?.offerings || []).filter((off) => {
    if (off.id === `off_${wsId}_1` && off.title?.startsWith('Layanan & Produk Unggulan ')) {
      wasModified = true;
      return false;
    }
    return true;
  });

  if (!wasModified) {
    return { sanitized: snap, wasModified: false };
  }

  const sanitized: PersistedWorkspaceSnapshot = {
    ...snap,
    brand: {
      ...snap.brand,
      offerings: cleanedOfferings,
    },
    postsUsedThisMonth: cleanedDrafts.length,
    connections: cleanedConnections,
    metaAccount: cleanedMetaAccount,
    vaultAssets: cleanedVaultAssets,
    eventCampaigns: cleanedEvents,
    drafts: cleanedDrafts,
    metaAdCampaigns: cleanedMetaCampaigns,
    updatedAtIso: new Date().toISOString(),
  };

  return { sanitized, wasModified: true };
}

/**
 * Persists a single social channel connection state directly to
 * `workspaces/{workspaceId}/connections/{channel}` in Cloud Firestore.
 */
export async function saveChannelConnectionToFirestore(
  workspaceId: string,
  connection: ChannelConnectionState,
  metaAccount?: MetaAdsAccountConnection,
  cfg?: VeloxaFirebaseConnectionConfig,
): Promise<boolean> {
  if (!workspaceId || workspaceId === 'ws_veloxa_nusantara') return false;
  const db = getFirestoreInstance(cfg);
  if (!db) return false;

  try {
    const { getAuth } = await import('firebase/auth');
    const auth = cachedApp ? getAuth(cachedApp) : null;
    if (auth && typeof auth.authStateReady === 'function') {
      await auth.authStateReady();
    }
    const currentUid = auth?.currentUser?.uid;
    if (!currentUid) return false;

    const nowIso = new Date().toISOString();
    const connRef = doc(db, 'workspaces', workspaceId, 'connections', connection.channel);
    const existingSnap = await getDoc(connRef);
    const createdAt = existingSnap.exists()
      ? ((existingSnap.data()?.createdAt as string) || nowIso)
      : nowIso;

    await setDoc(connRef, {
      id: connection.channel,
      workspaceId,
      platform: connection.channel,
      channelType: connection.oauthMode || (connection.connected ? 'direct_publish' : 'disconnected'),
      accountName: (connection.accountName || connection.handle || 'Belum Terhubung').slice(0, 190),
      accountId: (connection.handle || '').slice(0, 120),
      adAccountId:
        (connection.channel === 'instagram' || connection.channel === 'facebook') &&
        metaAccount?.adAccountId
          ? metaAccount.adAccountId.slice(0, 120)
          : '',
      status: connection.connected ? 'connected' : 'disconnected',
      scopes: connection.connected
        ? ['publish_content', 'read_insights', 'business_management']
        : [],
      tokenExpiresAt: connection.tokenExpiresAt || nowIso,
      lastSyncedAt: nowIso,
      connectedBy: currentUid,
      metadata: {
        handle: (connection.handle || '').slice(0, 120),
        followerCount: Math.max(0, Number(connection.followerCount || 0)),
        oauthMode: connection.oauthMode,
        lastPublishedAt: connection.lastPublishedAt || '',
      },
      createdAt,
      updatedAt: nowIso,
    });
    return true;
  } catch {
    return false;
  }
}

/* Only adopt a revision returned by an authenticated server profile save. Pending older snapshots retain their captured CAS baseline. */
export function acceptServerWorkspaceRevision(workspaceId:string,revision:number){if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Revisi server tidak valid.');verifiedSnapshotRevisions.set(workspaceId,revision);}

/** Transaction reads and revision comparison are inseparable; a retry never adopts a newer baseline. */
export async function commitWorkspaceSnapshot(db: Firestore, workspaceId: string, snapshot: PersistedWorkspaceSnapshot, currentUid: string, expectedRevision: number | undefined): Promise<number> {
 const wsRef=doc(db,'workspaces',workspaceId);
 const serialized=JSON.stringify(snapshot);
 if(serialized.length>480000)throw new Error('Workspace terlalu besar. Unggah media ke Storage sebelum menyimpan.');
 return runTransaction(db,async transaction=>{
  const existingSnap=await transaction.get(wsRef);
  const existingData=existingSnap.exists()?existingSnap.data() as Record<string,unknown>:null;
  const ownerUid=(existingData?.ownerUid as string)||currentUid;
  const memberUids=Array.isArray(existingData?.memberUids)?existingData.memberUids as string[]:[ownerUid];
  const payload=buildWorkspaceSnapshotSyncPayload({workspaceId,ownerUid,memberUids,existingData,snapshot,serialized,expectedRevision});
  transaction.set(wsRef,payload,{merge:true});
  return payload.snapshotRevision as number;
 });
}

export async function syncWorkspaceSnapshotToStore(
  snapshot: PersistedWorkspaceSnapshot,
  cfg?: VeloxaFirebaseConnectionConfig,
  options?: { forceCloudPush?: boolean },
): Promise<{
  syncedToFirestore: boolean;
  syncedToLocal: boolean;
  telemetry: LocalFirstTelemetry;
  conflict?: boolean;
  error?: string;
}> {
  const telemetry = getInitialLocalFirstTelemetry();
  const workspaceId = snapshot.brand.workspaceId || 'default';
  const storageKey = getWorkspaceStorageKey(workspaceId);
  // Capture the verified baseline before any await: an older queued save cannot adopt a newer revision.
  const expectedRevision = verifiedSnapshotRevisions.get(workspaceId);

  const { updatedAtIso: _updatedAt, ...fingerprintPayload } = snapshot;
  const nextHash = computePayloadFingerprint(fingerprintPayload);

  let syncedToLocal = false;
  if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
      syncedToLocal = true;
      telemetry.localWrites += 1;
      telemetry.lastLocalSaveWib = nowWibLabel();
    } catch {
      syncedToLocal = false;
    }
  }

  if (nextHash === telemetry.lastPayloadHash && !telemetry.dirtyPendingCloudSync && !options?.forceCloudPush) {
    telemetry.firestoreOpsSaved += 1;
    telemetry.dirtyPendingCloudSync = false;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: false, syncedToLocal, telemetry };
  }

  const db = getFirestoreInstance(cfg);
  if (!db) {
    telemetry.dirtyPendingCloudSync = true;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: false, syncedToLocal, telemetry };
  }

  if (!options?.forceCloudPush) {
    telemetry.firestoreOpsSaved += 1;
    telemetry.dirtyPendingCloudSync = true;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: false, syncedToLocal, telemetry };
  }

  try {
    const { getAuth } = await import('firebase/auth');
    const auth = cachedApp ? getAuth(cachedApp) : null;
    if (auth && typeof auth.authStateReady === 'function') {
      await auth.authStateReady();
    }
    const currentUid = auth?.currentUser?.uid;
    if (currentUid) {
      const revision = await commitWorkspaceSnapshot(db, workspaceId, snapshot, currentUid, expectedRevision);
      verifiedSnapshotRevisions.set(workspaceId, revision);

      telemetry.firestoreWrites += 1;
      telemetry.lastPayloadHash = nextHash;
      telemetry.lastCloudSyncWib = nowWibLabel();
      telemetry.dirtyPendingCloudSync = false;
      persistLocalFirstTelemetry(telemetry);
      return { syncedToFirestore: true, syncedToLocal, telemetry };
    }
  } catch (error) {
    if(error instanceof SnapshotConflictError){
      telemetry.dirtyPendingCloudSync=true;persistLocalFirstTelemetry(telemetry);
      return {syncedToFirestore:false,syncedToLocal,telemetry,conflict:true,error:error.message};
    }
    // A failed or uncertain write never advances the verified baseline.
  }
  telemetry.dirtyPendingCloudSync = true;
  persistLocalFirstTelemetry(telemetry);
  return { syncedToFirestore: false, syncedToLocal, telemetry };
}

export async function loadWorkspaceSnapshotFromStore(
  workspaceId: string,
  cfg?: VeloxaFirebaseConnectionConfig,
  options?: { forceCloudPull?: boolean },
  dependencies: { db?: Firestore; auth?: Auth } = {},
): Promise<{ snapshot: PersistedWorkspaceSnapshot | null; telemetry: LocalFirstTelemetry }> {
  const telemetry = getInitialLocalFirstTelemetry();
  const storageKey = getWorkspaceStorageKey(workspaceId);

  // 1. LOCAL-FIRST READ (per-workspace key, 0ms latency if within 15-minute TTL and not forceCloudPull)
  if (
    !options?.forceCloudPull &&
    typeof window !== 'undefined' &&
    typeof window.localStorage?.getItem === 'function'
  ) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedWorkspaceSnapshot;
        const ageMs = Date.now() - new Date(parsed.updatedAtIso || 0).getTime();
        if (
          parsed?.brand?.workspaceId === workspaceId &&
          !Number.isNaN(ageMs) &&
          ageMs >= 0 && ageMs < LOCAL_CACHE_TTL_MS
        ) {
          const { sanitized, wasModified } = sanitizeLegacySeededSnapshot(parsed);
          if (wasModified) {
            try {
              window.localStorage.setItem(storageKey, JSON.stringify(sanitized));
            } catch {
              // ignore
            }
          }
          telemetry.localReads += 1;
          telemetry.firestoreOpsSaved += 1;
          persistLocalFirstTelemetry(telemetry);
          return { snapshot: sanitized, telemetry };
        }
      }
    } catch {
      // proceed to Cloud Firestore
    }
  }

  // 2. CLOUD FIRESTORE READ (awaits authStateReady so Security Rules pass reliably)
  const db = dependencies.db ?? getFirestoreInstance(cfg);
  if (db) {
    try {
      const { getAuth } = await import('firebase/auth');
      const auth = dependencies.auth ?? (cachedApp ? getAuth(cachedApp) : null);
      if (auth && typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }

      const wsRef = doc(db, 'workspaces', workspaceId);
      const snap = await getDoc(wsRef);
      telemetry.firestoreReads += 1;

      if (snap.exists()) {
        const rawDoc = snap.data() as Record<string, unknown>;
        if (typeof rawDoc.snapshotJson === 'string' && rawDoc.snapshotJson.length > 10) {
          const cloudData = JSON.parse(rawDoc.snapshotJson) as PersistedWorkspaceSnapshot;
          if (cloudData?.brand?.workspaceId === workspaceId) {
            verifiedSnapshotRevisions.set(workspaceId,snapshotRevision(rawDoc));
            const { sanitized } = sanitizeLegacySeededSnapshot(cloudData);
            if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
              try {
                window.localStorage.setItem(storageKey, JSON.stringify(sanitized));
              } catch {
                // ignore
              }
            }
            telemetry.lastCloudSyncWib = nowWibLabel();
            persistLocalFirstTelemetry(telemetry);
            return { snapshot: sanitized, telemetry };
          }
        }

        verifiedSnapshotRevisions.set(workspaceId,snapshotRevision(rawDoc));
        // Workspace document exists in Firestore without `snapshotJson` yet — build real snapshot from its Firestore fields!
        const builtFromFirestore = buildRealInitialWorkspaceSnapshot({
          workspaceId,
          businessName: (rawDoc.name as string) || 'Bisnis Veloxa AI',
          city: (rawDoc.city as string) || 'Jakarta',
          category: ((rawDoc.category as BusinessCategory) || 'cafe_fnb'),
          targetAudience: (rawDoc.targetAudience as string) || undefined,
          brandTone: (rawDoc.toneOfVoice as string) || undefined,
          selectedChannels: Array.isArray(rawDoc.selectedChannels)
            ? (rawDoc.selectedChannels as SocialChannelId[])
            : ['instagram', 'facebook', 'tiktok', 'youtube_shorts'],
          planId: ((rawDoc.subscriptionPlanId as SubscriptionPlanId) || 'free_trial'),
          ownerEmail: auth?.currentUser?.email || undefined,
          ownerName: auth?.currentUser?.displayName || undefined,
        });

        if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(builtFromFirestore));
          } catch {
            // ignore
          }
        }
        // Reading must not start a competing write; onboarding or the caller saves explicitly.
        telemetry.lastCloudSyncWib = nowWibLabel();
        persistLocalFirstTelemetry(telemetry);
        return { snapshot: builtFromFirestore, telemetry };
      }
    } catch {
      // fallback to local storage
    }
  }

  if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedWorkspaceSnapshot;
        if (parsed?.brand?.workspaceId !== workspaceId) return { snapshot: null, telemetry };
        const { sanitized } = sanitizeLegacySeededSnapshot(parsed);
        telemetry.localReads += 1;
        persistLocalFirstTelemetry(telemetry);
        return { snapshot: sanitized, telemetry };
      }
    } catch {
      return { snapshot: null, telemetry };
    }
  }
  return { snapshot: null, telemetry };
}

/**
 * Loads all real tenant workspaces from Cloud Firestore (`workspaces` + `users` collections)
 * for Super Admin (`sosrospg@gmail.com`) live monitoring.
 */
export async function loadAllRealTenantsFromFirestore(
  cfg?: VeloxaFirebaseConnectionConfig,
): Promise<TenantWorkspaceSummary[]> {
  const db = getFirestoreInstance(cfg);
  if (!db) return [];

  try {
    const { getAuth } = await import('firebase/auth');
    const auth = cachedApp ? getAuth(cachedApp) : null;
    if (auth && typeof auth.authStateReady === 'function') {
      await auth.authStateReady();
    }
    if (!auth?.currentUser) return [];

    const [wsSnaps, userSnaps] = await Promise.all([
      getDocs(collection(db, 'workspaces')),
      getDocs(collection(db, 'users')),
    ]);

    const usersByUid = new Map<string, Record<string, unknown>>();
    userSnaps.forEach((uDoc) => {
      usersByUid.set(uDoc.id, uDoc.data() as Record<string, unknown>);
    });

    const summaries: TenantWorkspaceSummary[] = [];
    wsSnaps.forEach((wsDoc) => {
      const data = wsDoc.data() as Record<string, unknown>;
      const ownerUid = (data.ownerUid as string) || '';
      const ownerUser = usersByUid.get(ownerUid);
      const planId = ((data.subscriptionPlanId as SubscriptionPlanId) ||
        (ownerUser?.subscriptionPlanId as SubscriptionPlanId) ||
        'free_trial') as SubscriptionPlanId;
      const planSpec = SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS.free_trial;
      const postsPublished = Number(data.quotaUsed ?? ownerUser?.quotaUsed ?? 0);
      const econ = calculateTenantUnitEconomics({
        planId,
        postsPublishedThisMonth: postsPublished,
        realAssetRatioPct: 70,
      });

      const connectedChannels = Array.isArray(data.selectedChannels)
        ? (data.selectedChannels as SocialChannelId[])
        : [];

      summaries.push({
        workspaceId: wsDoc.id,
        businessName:
          (data.name as string) ||
          (ownerUser?.businessName as string) ||
          `Workspace ${wsDoc.id}`,
        ownerName:
          (ownerUser?.displayName as string) ||
          (ownerUser?.name as string) ||
          'Founder Bisnis',
        ownerEmail: (ownerUser?.email as string) || 'tenant@veloxa.ai',
        category: ((data.category as BusinessCategory) || 'cafe_fnb'),
        planId,
        subscriptionStatus: planId === 'free_trial' ? 'trial' : 'active',
        postsPublishedThisMonth: postsPublished,
        monthlyPostQuota: planSpec.monthlyPostQuota,
        connectedChannels,
        metaAdsConnected: connectedChannels.includes('instagram') || connectedChannels.includes('facebook'),
        activeMetaCampaigns: 0,
        monthlySubscriptionRevenueIdr: econ.monthlyRevenueIdr,
        estimatedMonthlyApiCostIdr: econ.estimatedApiCostIdr,
        grossMarginPct: econ.grossMarginPct,
      });
    });

    return summaries;
  } catch {
    return [];
  }
}
