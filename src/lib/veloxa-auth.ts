/**
 * Veloxa AI — Multi-Tenant Firebase Authentication & Cloud Firestore Onboarding Service
 *
 * Implements:
 * 1. Simple, fast Registration (`/register`) -> Creates Firebase Auth user + immediately writes
 *    clean 15-key `users/{uid}` & initial `workspaces/{workspaceId}` in Cloud Firestore (`onboardingCompleted: false`).
 * 2. Step-by-Step Onboarding Wizard (`/onboarding`) -> Configures Brand Profile, Target Channels,
 *    and Plan Selection (including Free Trial `free_trial` Rp0) -> Writes `onboardingCompleted: true`
 *    and real initial workspace snapshot (`snapshotJson`) to `users/{uid}`, `workspaces/{workspaceId}`,
 *    and `workspaces/{workspaceId}/brand_brain/main` in Cloud Firestore.
 * 3. Reliable Login Hydration (`/login`) -> Waits for `auth.authStateReady()`, checks both `users/{uid}`
 *    and `workspaces/{workspaceId}` in Cloud Firestore so any user who completed onboarding NEVER gets
 *    sent back to `/onboarding` after logging out and logging back in.
 */

import { isVerifiedAdmin } from './veloxa-workspace-policy';
import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { SUBSCRIPTION_PLANS } from './veloxa-engine';
import {
  buildRealInitialWorkspaceSnapshot,
  getFirestoreInstance,
  loadSavedFirebaseConfig,
  loadWorkspaceSnapshotFromStore,
  mergeOnboardingSnapshot,
  syncWorkspaceSnapshotToStore,
  type VeloxaFirebaseConnectionConfig,
} from './veloxa-firestore-repo';
import type {
  BusinessCategory,
  SocialChannelId,
  SubscriptionPlanId,
  VeloxaRole,
} from './veloxa-types';

export interface VeloxaPendingRegistrationBrand {
  businessName: string;
  city: string;
  category: BusinessCategory;
  planId: SubscriptionPlanId;
  ownerName: string;
  ownerEmail: string;
  targetAudience?: string;
  brandTone?: string;
  selectedChannels?: SocialChannelId[];
}

const PENDING_REGISTRATION_BRAND_KEY = 'veloxa_pending_registration_brand_v1';

export interface VeloxaAuthenticatedUser {
  uid: string;
  email: string;
  displayName: string;
  role: VeloxaRole;
  provider: 'google' | 'email_password' | 'super_admin_session' | 'demo_tenant';
  isSuperAdmin: boolean;
  onboardingCompleted?: boolean;
  activeWorkspaceId?: string;
  subscriptionPlanId?: SubscriptionPlanId;
  businessName?: string;
  city?: string;
  category?: BusinessCategory;
  targetAudience?: string;
  brandTone?: string;
  selectedChannels?: SocialChannelId[];
  syncedToFirestore?: boolean;
}

const LOCAL_AUTH_SESSION_KEY = 'veloxa_prod_auth_session_v2';
export const SUPER_ADMIN_EMAIL = 'sosrospg@gmail.com';

let cachedAuth: Auth | null = null;

export function getFirebaseAuthInstance(cfg?: VeloxaFirebaseConnectionConfig): Auth | null {
  const activeCfg = cfg || loadSavedFirebaseConfig();
  if (!activeCfg.projectId || !activeCfg.apiKey) return null;
  try {
    if (!cachedAuth) {
      const existing = getApps().find((a) => a.name === 'veloxa-client');
      const app =
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
      cachedAuth = getAuth(app);
    }
    return cachedAuth;
  } catch {
    return null;
  }
}

export function resolveRoleFromEmail(email?: string | null): VeloxaRole {
  const normalized = (email || '').trim().toLowerCase();
  return normalized === SUPER_ADMIN_EMAIL ? 'admin' : 'user';
}

export function getInitialAuthenticatedUser(): VeloxaAuthenticatedUser | null {
  if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
    try {
      const raw = window.localStorage.getItem(LOCAL_AUTH_SESSION_KEY);
      if (raw) {
        return JSON.parse(raw) as VeloxaAuthenticatedUser;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function persistAuthenticatedUser(user: VeloxaAuthenticatedUser | null): void {
  if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
    try {
      if (!user) {
        window.localStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
      } else {
        window.localStorage.setItem(LOCAL_AUTH_SESSION_KEY, JSON.stringify(user));
      }
    } catch {
      // ignore
    }
  }
}

export function buildWorkspaceIdForUid(uid: string): string {
  if (!uid) throw new Error('Identitas pengguna tidak tersedia.');
  return `ws_${encodeURIComponent(uid)}`;
}

/**
 * Synchronizes `users/{uid}` and `workspaces/{workspaceId}` in Cloud Firestore (`veloxa-ai-saas`).
 *
 * Uses a compact <=16-key document payload on `users/{uid}` (preserving immutable `uid`, `id`,
 * `role`, `createdAt`) so Firestore Security Rules never hit expression evaluation limits,
 * and cross-checks `workspaces/{workspaceId}.onboardingCompleted` so previously onboarded users
 * are automatically migrated and never asked to repeat onboarding.
 */
export function buildImmutableProfileFields(
  existingData: Record<string, unknown> | null,
  initialFields: Record<string, unknown>,
): Record<string, unknown> {
  if (!existingData) return initialFields;
  return Object.fromEntries(
    Object.keys(initialFields)
      .filter((field) => Object.prototype.hasOwnProperty.call(existingData, field))
      .map((field) => [field, existingData[field]]),
  );
}

export async function syncUserProfileToFirestore(
  user: VeloxaAuthenticatedUser,
  options?: {
    forceOnboardingCompleted?: boolean;
    businessName?: string;
    city?: string;
    category?: BusinessCategory;
    targetAudience?: string;
    brandTone?: string;
    planId?: SubscriptionPlanId;
    selectedChannels?: SocialChannelId[];
  },
): Promise<VeloxaAuthenticatedUser> {
  const auth = getFirebaseAuthInstance();
  if (auth && typeof auth.authStateReady === 'function') {
    try {
      await auth.authStateReady();
    } catch {
      // ignore
    }
  }

  const activeUid = auth?.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser.uid : user.uid;
  const workspaceId = user.activeWorkspaceId || buildWorkspaceIdForUid(activeUid);
  const nowIso = new Date().toISOString();
  const db = getFirestoreInstance();

  if (!db || !auth?.currentUser || auth.currentUser.isAnonymous || auth.currentUser.uid !== user.uid) {
    throw new Error('Sesi Firebase tidak valid. Silakan masuk kembali.');
  }

  try {
    const userRef = doc(db, 'users', activeUid);
    const existingUserSnap = await getDoc(userRef);
    const existingUserData = existingUserSnap.exists()
      ? (existingUserSnap.data() as Record<string, unknown>) : null;
    const resolvedWorkspaceId = (existingUserData?.activeWorkspaceId as string) || workspaceId;
    const wsRef = doc(db, 'workspaces', resolvedWorkspaceId);
    // A new workspace is not yet readable under owner-based security rules.
    const existingWsSnap = await getDoc(wsRef).catch((error) => {
      if (!existingUserData && error?.code === 'permission-denied') return null;
      throw error;
    });
    const existingWsData = existingWsSnap?.exists()
      ? (existingWsSnap.data() as Record<string, unknown>) : null;

    // Onboarding is completed if forced true, or already true in EITHER users/{uid} OR workspaces/{wsId}, or Super Admin
    const alreadyOnboardedInCloud =
      Boolean(existingUserData?.onboardingCompleted) ||
      Boolean(existingWsData?.onboardingCompleted) ||
      Boolean(existingWsData?.onboardingStep === 3);

    const resolvedOnboarding =
      options?.forceOnboardingCompleted === true
        ? true
        : alreadyOnboardedInCloud
          ? true
          : options?.forceOnboardingCompleted === false
            ? false
            : Boolean(user.onboardingCompleted ?? user.isSuperAdmin);

    const resolvedWsId =
      (existingUserData?.activeWorkspaceId as string) || workspaceId;

    const resolvedPlan = ((existingWsData?.subscriptionPlanId as SubscriptionPlanId) ||
      (existingUserData?.subscriptionPlanId as SubscriptionPlanId) ||
      'free_trial') as SubscriptionPlanId;

    const resolvedBusinessName = (
      options?.businessName ||
      (existingWsData?.name as string) ||
      (existingUserData?.businessName as string) ||
      user.businessName ||
      `${user.displayName} Brand`
    ).slice(0, 110);

    const resolvedCity = (
      options?.city ||
      (existingWsData?.city as string) ||
      (existingUserData?.city as string) ||
      user.city ||
      'Jakarta'
    ).slice(0, 80);

    const resolvedCategory = (options?.category ||
      (existingWsData?.category as BusinessCategory) ||
      (existingUserData?.category as BusinessCategory) ||
      user.category ||
      'cafe_fnb') as BusinessCategory;

    const resolvedAudience = (
      options?.targetAudience ||
      (existingWsData?.targetAudience as string) ||
      user.targetAudience ||
      `Pelanggan potensial ${resolvedBusinessName} di ${resolvedCity}`
    ).slice(0, 400);

    const resolvedTone = (
      options?.brandTone ||
      (existingWsData?.toneOfVoice as string) ||
      user.brandTone ||
      'Profesional, autentik, dekat dengan pelanggan, dan persuasif'
    ).slice(0, 250);

    const resolvedChannels = (options?.selectedChannels ||
      (existingWsData?.selectedChannels as SocialChannelId[]) ||
      (existingUserData?.selectedChannels as SocialChannelId[]) ||
      user.selectedChannels || [
        'instagram',
        'facebook',
        'tiktok',
        'youtube_shorts',
      ]) as SocialChannelId[];

    const planSpec = SUBSCRIPTION_PLANS[resolvedPlan] || SUBSCRIPTION_PLANS.free_trial;
    const immutableRole =
      (existingUserData?.role as VeloxaRole) || (user.isSuperAdmin ? 'admin' : 'user');
    const userImmutableFields = buildImmutableProfileFields(existingUserData, {
      uid: activeUid,
      ...(existingUserData && 'id' in existingUserData ? { id: existingUserData.id } : {}),
      role: immutableRole,
      createdAt: nowIso,
    });
    const existingQuotaUsed = Number(
      existingWsData?.quotaUsed ?? existingUserData?.quotaUsed ?? 0,
    );

    // Compact 15-16 key document payload for `users/{uid}` (avoids 19+ key rule limit and preserves immutable fields)
    const cleanUserDoc: Record<string, unknown> = {
      ...userImmutableFields,
      email: user.email,
      displayName: user.displayName.slice(0, 110),
      provider: user.provider,
      activeWorkspaceId: resolvedWsId,
      subscriptionPlanId: resolvedPlan,
      quotaLimit: planSpec.monthlyPostQuota,
      quotaUsed: existingQuotaUsed,
      onboardingCompleted: resolvedOnboarding,
      businessName: resolvedBusinessName,
      city: resolvedCity,
      category: resolvedCategory,
      selectedChannels: resolvedChannels,
      updatedAt: nowIso,
    };

    if (existingUserData) {
      delete cleanUserDoc.subscriptionPlanId;
      delete cleanUserDoc.quotaLimit;
      delete cleanUserDoc.quotaUsed;
    }
    const batch = writeBatch(db);
    batch.set(userRef, cleanUserDoc, { merge: true });

    // Ensure `workspaces/{resolvedWsId}` exists and is up to date in Cloud Firestore
    if (!existingWsData || options?.forceOnboardingCompleted !== undefined || options?.businessName) {
      const targetWsRef = doc(db, 'workspaces', resolvedWsId);
      const workspaceImmutableFields = buildImmutableProfileFields(existingWsData, {
        id: resolvedWsId,
        ownerUid: activeUid,
        createdAt: nowIso,
      });
      const wsPayload: Record<string, unknown> = {
        ...workspaceImmutableFields,
        memberUids: existingWsData?.memberUids || [(workspaceImmutableFields.ownerUid as string) || activeUid],
        name: resolvedBusinessName,
        category: resolvedCategory,
        city: resolvedCity,
        targetAudience: resolvedAudience,
        toneOfVoice: resolvedTone,
        subscriptionPlanId: resolvedPlan,
        quotaLimit: planSpec.monthlyPostQuota,
        quotaUsed: existingQuotaUsed,
        autonomyEnabled: true,
        onboardingCompleted: resolvedOnboarding,
        onboardingStep: resolvedOnboarding ? 3 : 1,
        selectedChannels: resolvedChannels,
        ...(typeof existingWsData?.snapshotJson === 'string'
          ? { snapshotJson: existingWsData.snapshotJson }
          : {}),
        updatedAt: nowIso,
      };
      if (existingWsData) {
        delete wsPayload.subscriptionPlanId;
        delete wsPayload.quotaLimit;
        delete wsPayload.quotaUsed;
      }
      batch.set(targetWsRef, wsPayload, { merge: true });
    }

    await batch.commit();
    const hydrated: VeloxaAuthenticatedUser = {
      ...user,
      uid: activeUid,
      role: user.isSuperAdmin ? 'admin' : 'user',
      activeWorkspaceId: resolvedWsId,
      onboardingCompleted: resolvedOnboarding,
      subscriptionPlanId: resolvedPlan,
      businessName: resolvedBusinessName,
      city: resolvedCity,
      category: resolvedCategory,
      targetAudience: resolvedAudience,
      brandTone: resolvedTone,
      selectedChannels: resolvedChannels,
      syncedToFirestore: true,
    };
    persistAuthenticatedUser(hydrated);
    return hydrated;
  } catch (error) {
    throw error;
  }
}

async function mapFirebaseUser(user: User, fallbackEmail?: string, customName?: string): Promise<VeloxaAuthenticatedUser> {
  const email = (user.email || fallbackEmail || 'tenant@veloxa.ai').trim().toLowerCase();
  const token = await user.getIdTokenResult();
  const isSuper = isVerifiedAdmin({ role: token.claims.role, email, email_verified: user.emailVerified });
  const workspaceId = buildWorkspaceIdForUid(user.uid);
  return {
    uid: user.uid,
    email,
    displayName:
      customName?.trim() ||
      user.displayName ||
      (isSuper ? 'Super Admin Veloxa AI' : email.split('@')[0] || 'Pelanggan Veloxa'),
    role: isSuper ? 'admin' : 'user',
    provider: user.providerData[0]?.providerId === 'google.com' ? 'google' : 'email_password',
    isSuperAdmin: isSuper,
    activeWorkspaceId: workspaceId,
  };
}

/**
 * Simple Account Registration (`/register`):
 * Creates the account in Firebase Auth + writes `users/{uid}` and `workspaces/{workspaceId}`
 * in Cloud Firestore with `onboardingCompleted: false` (unless existing user already completed onboarding).
 */
export async function registerNewVeloxaAccount(params: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: VeloxaAuthenticatedUser; isNewRegistration: boolean }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.name.trim() || cleanEmail.split('@')[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || params.password.length < 6) {
    throw new Error('Gunakan email valid dan kata sandi minimal 6 karakter.');
  }
  const auth = getFirebaseAuthInstance();
  if (!auth) throw new Error('Konfigurasi Firebase belum tersedia.');
  const created = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
  await updateProfile(created.user, { displayName: cleanName });
  const mapped = await mapFirebaseUser(created.user, cleanEmail, cleanName);
  const synced = await syncUserProfileToFirestore(mapped, { forceOnboardingCompleted: mapped.isSuperAdmin, planId: 'free_trial' });
  return { user: synced, isNewRegistration: true };
}

/**
 * Completes the 3-step Onboarding Wizard (`/onboarding`) and writes:
 * 1. `users/{uid}` with `onboardingCompleted: true`
 * 2. `workspaces/{workspaceId}` with `onboardingCompleted: true` and full real `snapshotJson`
 * 3. `workspaces/{workspaceId}/brand_brain/main` with the user's real Brand Brain configuration
 */
export async function completeVeloxaOnboarding(params: {
  businessName: string;
  city: string;
  category: BusinessCategory;
  targetAudience: string;
  brandTone: string;
  selectedChannels: SocialChannelId[];
  planId: SubscriptionPlanId;
}): Promise<VeloxaAuthenticatedUser> {
  const auth = getFirebaseAuthInstance();
  if (auth && typeof auth.authStateReady === 'function') {
    try {
      await auth.authStateReady();
    } catch {
      // ignore
    }
  }
  const fbUser = auth?.currentUser;
  if (!fbUser || fbUser.isAnonymous) throw new Error('Silakan masuk sebelum melengkapi workspace.');
  const baseUser = await mapFirebaseUser(fbUser);

  const workspaceId = baseUser.activeWorkspaceId || buildWorkspaceIdForUid(baseUser.uid);
  const nowIso = new Date().toISOString();

  // Persist pending brand for instant Workspace hydration on `/`
  persistPendingRegistrationBrand({
    businessName: params.businessName.trim(),
    city: params.city.trim(),
    category: params.category,
    planId: params.planId,
    ownerName: baseUser.displayName,
    ownerEmail: baseUser.email,
    targetAudience: params.targetAudience.trim(),
    brandTone: params.brandTone.trim(),
    selectedChannels: params.selectedChannels,
  });

  // 1. Update `users/{uid}` and `workspaces/{workspaceId}` in Cloud Firestore with `onboardingCompleted: true`
  const syncedUser = await syncUserProfileToFirestore(baseUser, {
    forceOnboardingCompleted: false,
    businessName: params.businessName.trim(),
    city: params.city.trim(),
    category: params.category,
    targetAudience: params.targetAudience.trim(),
    brandTone: params.brandTone.trim(),
    planId: params.planId,
    selectedChannels: params.selectedChannels,
  });

  // 2. Build 100% real initial workspace snapshot for this user's brand and push to Cloud Firestore (`workspaces/{workspaceId}`)
  const freshSnapshot = buildRealInitialWorkspaceSnapshot({
    workspaceId: syncedUser.activeWorkspaceId || workspaceId,
    businessName: params.businessName.trim(),
    city: params.city.trim(),
    category: params.category,
    targetAudience: params.targetAudience.trim(),
    brandTone: params.brandTone.trim(),
    selectedChannels: params.selectedChannels,
    planId: syncedUser.subscriptionPlanId || 'free_trial',
    ownerName: syncedUser.displayName,
    ownerEmail: syncedUser.email,
  });

  const previous = await loadWorkspaceSnapshotFromStore(syncedUser.activeWorkspaceId || workspaceId, undefined, { forceCloudPull: true });
  const realSnapshot = mergeOnboardingSnapshot(previous.snapshot, freshSnapshot);
  realSnapshot.activePlanId = syncedUser.subscriptionPlanId || 'free_trial';
  const result = await syncWorkspaceSnapshotToStore(realSnapshot, undefined, { forceCloudPush: true });
  if (!result.syncedToFirestore) throw new Error('Workspace belum tersimpan ke cloud. Silakan coba lagi.');

  // 3. Write `workspaces/{workspaceId}/brand_brain/main` in Cloud Firestore
  const db = getFirestoreInstance();
  if (db) {
    try {
      const brandBrainRef = doc(
        db,
        'workspaces',
        syncedUser.activeWorkspaceId || workspaceId,
        'brand_brain',
        'main',
      );
      const existingBrain = await getDoc(brandBrainRef);
      await setDoc(brandBrainRef, {
        id: 'main',
        workspaceId: syncedUser.activeWorkspaceId || workspaceId,
        brandName: params.businessName.trim().slice(0, 110),
        tagline: `Studio Otonom ${params.businessName.trim()} (${params.city.trim()})`,
        description: `Profil Brand Brain AI untuk ${params.businessName.trim()} di ${params.city.trim()}.`,
        category: params.category,
        targetAudience: params.targetAudience.trim().slice(0, 1000),
        toneOfVoice: params.brandTone.trim().slice(0, 400),
        primaryColor: '#EC749B',
        accentColor: '#171717',
        updatedBy: syncedUser.uid,
        createdAt: existingBrain.data()?.createdAt || nowIso,
        updatedAt: nowIso,
      }, { merge: true });
    } catch (error) {
      throw error;
    }
  }

  return syncUserProfileToFirestore(syncedUser, { forceOnboardingCompleted: true });
}

export async function signInWithEmailPasswordOrRegister(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<VeloxaAuthenticatedUser> {
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail || params.password.length < 6) throw new Error('Email atau kata sandi tidak valid.');
  const auth = getFirebaseAuthInstance();
  if (!auth) throw new Error('Konfigurasi Firebase belum tersedia.');
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, params.password);
  return syncUserProfileToFirestore(await mapFirebaseUser(cred.user));
}

export async function signInWithGooglePopup(options?: { isRegistrationFlow?: boolean }): Promise<VeloxaAuthenticatedUser> {
  const auth = getFirebaseAuthInstance();
  if (!auth) throw new Error('Konfigurasi Firebase belum tersedia.');
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  const mapped = await mapFirebaseUser(cred.user);
  return syncUserProfileToFirestore(mapped, options?.isRegistrationFlow ? { forceOnboardingCompleted: mapped.isSuperAdmin } : undefined);
}

/** Demo sessions must never impersonate authenticated users or administrators. */
export function signInQuickRoleSession(_targetRole: 'admin' | 'user'): VeloxaAuthenticatedUser {
  throw new Error('Gunakan login Firebase untuk mengakses workspace.');
}

export async function signOutVeloxaUser(): Promise<null> {
  const auth = getFirebaseAuthInstance();
  if (auth) await signOut(auth);
  persistAuthenticatedUser(null);
  return null;
}

export function subscribeToFirebaseAuthChanges(
  callback: (user: VeloxaAuthenticatedUser | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  const auth = getFirebaseAuthInstance();
  if (!auth) { callback(null); return () => {}; }
  let generation = 0;
  const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
    const current = ++generation;
    if (!fbUser || fbUser.isAnonymous) {
      persistAuthenticatedUser(null);
      callback(null);
      return;
    }
    void mapFirebaseUser(fbUser).then(mapped => syncUserProfileToFirestore(mapped)).then((synced) => {
      if (current === generation) callback(synced);
    }).catch((error) => {
      if (current === generation) { callback(null); onError?.(error); }
    });
  }, onError);
  return () => { generation++; unsubscribe(); };
}

export async function sendVeloxaPasswordReset(email: string): Promise<{
  ok: boolean;
  email: string;
  deliveredViaFirebase: boolean;
  resetReferenceCode: string;
}> {
  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error('Masukkan alamat email yang valid.');
  const auth = getFirebaseAuthInstance();
  if (!auth) throw new Error('Konfigurasi Firebase belum tersedia.');
  await sendPasswordResetEmail(auth, cleanEmail);
  return { ok: true, email: cleanEmail, deliveredViaFirebase: true, resetReferenceCode: '' };
}

export function persistPendingRegistrationBrand(brand: VeloxaPendingRegistrationBrand): void {
  if (typeof window !== 'undefined' && typeof window.localStorage?.setItem === 'function') {
    try {
      window.localStorage.setItem(PENDING_REGISTRATION_BRAND_KEY, JSON.stringify(brand));
    } catch {
      // ignore
    }
  }
}

export function consumePendingRegistrationBrand(): VeloxaPendingRegistrationBrand | null {
  if (typeof window !== 'undefined' && typeof window.localStorage?.getItem === 'function') {
    try {
      const raw = window.localStorage.getItem(PENDING_REGISTRATION_BRAND_KEY);
      if (raw) {
        window.localStorage.removeItem(PENDING_REGISTRATION_BRAND_KEY);
        return JSON.parse(raw) as VeloxaPendingRegistrationBrand;
      }
    } catch {
      // ignore
    }
  }
  return null;
}
