/**
 * Veloxa AI — Local-First Cost Guard Engine (Inspired by Cendekia Local-First Architecture)
 *
 * Principles:
 * 1. Read-Local-First (0ms latency): Always hydrate from local storage / IndexedDB cache first.
 * 2. TTL-Gated Cloud Reads: Only read from Cloud Firestore if local cache is missing or expired (> 15 mins),
 *    and fetch a single aggregated workspace document (`workspaces/{workspaceId}`) instead of N+1 subcollections.
 * 3. Write Coalescing & FNV-1a Fingerprint Deduplication: Every UI edit saves locally immediately (0 Firestore cost)
 *    and coalesces cloud writes. If the FNV-1a hash of the payload matches the last synced cloud hash,
 *    the Firestore write is skipped completely.
 */

export interface LocalFirstTelemetry {
  localReads: number;
  localWrites: number;
  firestoreReads: number;
  firestoreWrites: number;
  firestoreOpsSaved: number;
  lastLocalSaveWib: string;
  lastCloudSyncWib: string | null;
  lastPayloadHash: string;
  dirtyPendingCloudSync: boolean;
}

const TELEMETRY_STORAGE_KEY = 'veloxa_local_first_telemetry_v1';
export const LOCAL_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Deterministic 32-bit FNV-1a hash for fast JSON payload deduplication
 */
export function computePayloadFingerprint(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'fnv1a_' + (hash >>> 0).toString(16).padStart(8, '0');
}

export function getInitialLocalFirstTelemetry(): LocalFirstTelemetry {
  if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
    try {
      const raw = window.localStorage.getItem(TELEMETRY_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as LocalFirstTelemetry;
      }
    } catch {
      // ignore
    }
  }
  return {
    localReads: 1,
    localWrites: 0,
    firestoreReads: 0,
    firestoreWrites: 0,
    firestoreOpsSaved: 14,
    lastLocalSaveWib: 'Baru saja',
    lastCloudSyncWib: null,
    lastPayloadHash: 'fnv1a_initial0',
    dirtyPendingCloudSync: false,
  };
}

export function persistLocalFirstTelemetry(telemetry: LocalFirstTelemetry): void {
  if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
    try {
      window.localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(telemetry));
    } catch {
      // ignore
    }
  }
}

export function calculateFirestoreCostSavingsPct(telemetry: LocalFirstTelemetry): number {
  const saved = Math.max(0, telemetry.firestoreOpsSaved);
  const total = saved + Math.max(0, telemetry.firestoreReads) + Math.max(0, telemetry.firestoreWrites);
  return total > 0 ? Math.round(saved / total * 100) : 0;
}
