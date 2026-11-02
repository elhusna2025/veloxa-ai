/**
 * Veloxa AI — Multi-Tenant Cloud Firestore & Local-First Persistence Repository
 *
 * Implements Cendekia-style Local-First Cost Guard Architecture:
 * 1. Always hydrate from localStorage first (0ms latency, 0 Firestore read cost within 15m TTL).
 * 2. Single aggregated document per workspace (`workspaces/{workspaceId}`) instead of N+1 listeners.
 * 3. FNV-1a payload fingerprinting (`computePayloadFingerprint`) so unchanged snapshots never trigger
 *    redundant Firestore `setDoc` writes.
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
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
  ChannelConnectionState,
  ContentDraft,
  EventCampaign,
  MetaAdCampaignPlan,
  MetaAdsAccountConnection,
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

const LOCAL_STORAGE_WORKSPACE_KEY = 'veloxa_ai_workspace_snapshot_v1';
const LOCAL_STORAGE_FIREBASE_CFG_KEY = 'veloxa_ai_firebase_config_v1';

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;

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
    openAiApiKeyMasked: 'sk-proj-veloxa-agents-active••••',
    openAiConnected: true,
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

export async function syncWorkspaceSnapshotToStore(
  snapshot: PersistedWorkspaceSnapshot,
  cfg?: VeloxaFirebaseConnectionConfig,
  options?: { forceCloudPush?: boolean },
): Promise<{
  syncedToFirestore: boolean;
  syncedToLocal: boolean;
  telemetry: LocalFirstTelemetry;
}> {
  const telemetry = getInitialLocalFirstTelemetry();
  const fingerprintPayload = {
    brand: snapshot.brand,
    activePlanId: snapshot.activePlanId,
    postsUsedThisMonth: snapshot.postsUsedThisMonth,
    connections: snapshot.connections,
    metaAccount: snapshot.metaAccount,
    vaultAssetsCount: snapshot.vaultAssets.length,
    autonomyConfig: snapshot.autonomyConfig,
    eventCampaignsCount: snapshot.eventCampaigns.length,
    draftsCount: snapshot.drafts.length,
    metaAdCampaignsCount: snapshot.metaAdCampaigns.length,
    tenantsCount: snapshot.tenants.length,
    tenantsMrr: snapshot.tenants.map((t) => `${t.workspaceId}:${t.planId}`).join(','),
  };
  const nextHash = computePayloadFingerprint(fingerprintPayload);

  let syncedToLocal = false;
  if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_WORKSPACE_KEY, JSON.stringify(snapshot));
      syncedToLocal = true;
      telemetry.localWrites += 1;
      telemetry.lastLocalSaveWib = nowWibLabel();
    } catch {
      syncedToLocal = false;
    }
  }

  // Local-First Deduplication: Skip Firestore write if hash matches and forceCloudPush is false
  if (nextHash === telemetry.lastPayloadHash && !options?.forceCloudPush) {
    telemetry.firestoreOpsSaved += 1;
    telemetry.dirtyPendingCloudSync = false;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: false, syncedToLocal, telemetry };
  }

  const db = getFirestoreInstance(cfg);
  if (!db) {
    telemetry.lastPayloadHash = nextHash;
    telemetry.dirtyPendingCloudSync = true;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: false, syncedToLocal, telemetry };
  }

  // Coalesce rapid mutations unless explicitly forced to push to Cloud Firestore
  if (!options?.forceCloudPush) {
    telemetry.lastPayloadHash = nextHash;
    telemetry.firestoreOpsSaved += 1;
    telemetry.dirtyPendingCloudSync = true;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: false, syncedToLocal, telemetry };
  }

  try {
    const wsRef = doc(db, 'workspaces', snapshot.brand.workspaceId);
    await setDoc(wsRef, snapshot, { merge: true });
    telemetry.firestoreWrites += 1;
    telemetry.lastPayloadHash = nextHash;
    telemetry.lastCloudSyncWib = nowWibLabel();
    telemetry.dirtyPendingCloudSync = false;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: true, syncedToLocal, telemetry };
  } catch {
    telemetry.dirtyPendingCloudSync = true;
    persistLocalFirstTelemetry(telemetry);
    return { syncedToFirestore: false, syncedToLocal, telemetry };
  }
}

export async function loadWorkspaceSnapshotFromStore(
  workspaceId: string,
  cfg?: VeloxaFirebaseConnectionConfig,
  options?: { forceCloudPull?: boolean },
): Promise<{ snapshot: PersistedWorkspaceSnapshot | null; telemetry: LocalFirstTelemetry }> {
  const telemetry = getInitialLocalFirstTelemetry();

  // 1. LOCAL-FIRST READ (0ms latency, 0 Firestore Read Cost if within 15-minute TTL)
  if (
    !options?.forceCloudPull &&
    typeof window !== 'undefined' &&
    typeof window.localStorage?.getItem === 'function'
  ) {
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_WORKSPACE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedWorkspaceSnapshot;
        const ageMs = Date.now() - new Date(parsed.updatedAtIso || 0).getTime();
        if (!Number.isNaN(ageMs) && ageMs < LOCAL_CACHE_TTL_MS) {
          telemetry.localReads += 1;
          telemetry.firestoreOpsSaved += 1;
          persistLocalFirstTelemetry(telemetry);
          return { snapshot: parsed, telemetry };
        }
      }
    } catch {
      // proceed to cloud fallback
    }
  }

  // 2. CLOUD FIRESTORE FALLBACK (Only when local cache is missing/expired or forceCloudPull=true)
  const db = getFirestoreInstance(cfg);
  if (db) {
    try {
      const wsRef = doc(db, 'workspaces', workspaceId);
      const snap = await getDoc(wsRef);
      telemetry.firestoreReads += 1;
      if (snap.exists()) {
        const cloudData = snap.data() as PersistedWorkspaceSnapshot;
        telemetry.lastCloudSyncWib = nowWibLabel();
        persistLocalFirstTelemetry(telemetry);
        return { snapshot: cloudData, telemetry };
      }
    } catch {
      // fallback to local storage
    }
  }

  if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_WORKSPACE_KEY);
      if (raw) {
        telemetry.localReads += 1;
        persistLocalFirstTelemetry(telemetry);
        return { snapshot: JSON.parse(raw) as PersistedWorkspaceSnapshot, telemetry };
      }
    } catch {
      return { snapshot: null, telemetry };
    }
  }
  return { snapshot: null, telemetry };
}
