/**
 * Veloxa AI — Multi-Tenant Cloud Firestore & Local Persistence Repository
 *
 * Automatically connects to Cloud Firestore when Firebase Web Config is configured
 * (via `.env.local` or Super Admin Console), while persisting state seamlessly in
 * browser storage so zero changes are lost before or during Firebase setup.
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
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

export function getDefaultFirebaseConnectionConfig(): VeloxaFirebaseConnectionConfig {
  const envProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
  const envApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '';
  const envAuthDomain =
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    (envProjectId ? `${envProjectId}.firebaseapp.com` : '');
  const envStorageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    (envProjectId ? `${envProjectId}.firebasestorage.app` : '');

  return {
    projectId: envProjectId || 'veloxa-ai-prod',
    apiKey: envApiKey,
    authDomain: envAuthDomain || 'veloxa-ai-prod.firebaseapp.com',
    storageBucket: envStorageBucket || 'veloxa-ai-prod.firebasestorage.app',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
    openAiApiKeyMasked: process.env.OPENAI_API_KEY ? 'sk-proj-••••••••••••••••' : '',
    openAiConnected: Boolean(process.env.OPENAI_API_KEY),
    firebaseConnected: Boolean(envProjectId && envApiKey),
    lastSyncedAtWib: null,
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
    lastSyncedAtWib:
      new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
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
): Promise<{ syncedToFirestore: boolean; syncedToLocal: boolean }> {
  let syncedToLocal = false;
  if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_WORKSPACE_KEY, JSON.stringify(snapshot));
      syncedToLocal = true;
    } catch {
      syncedToLocal = false;
    }
  }

  const db = getFirestoreInstance(cfg);
  if (!db) {
    return { syncedToFirestore: false, syncedToLocal };
  }

  try {
    const wsRef = doc(db, 'workspaces', snapshot.brand.workspaceId);
    await setDoc(wsRef, snapshot, { merge: true });
    return { syncedToFirestore: true, syncedToLocal };
  } catch {
    return { syncedToFirestore: false, syncedToLocal };
  }
}

export async function loadWorkspaceSnapshotFromStore(
  workspaceId: string,
  cfg?: VeloxaFirebaseConnectionConfig,
): Promise<PersistedWorkspaceSnapshot | null> {
  const db = getFirestoreInstance(cfg);
  if (db) {
    try {
      const wsRef = doc(db, 'workspaces', workspaceId);
      const snap = await getDoc(wsRef);
      if (snap.exists()) {
        return snap.data() as PersistedWorkspaceSnapshot;
      }
    } catch {
      // fallback to local storage
    }
  }

  if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_WORKSPACE_KEY);
      if (raw) {
        return JSON.parse(raw) as PersistedWorkspaceSnapshot;
      }
    } catch {
      return null;
    }
  }
  return null;
}
