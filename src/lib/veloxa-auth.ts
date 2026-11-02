/**
 * Veloxa AI — Multi-Tenant Firebase Authentication & Cloud Firestore Onboarding Service
 *
 * Implements:
 * 1. Simple, fast Registration (`/register`) -> Creates Firebase Auth user + immediately writes
 *    `users/{uid}` & initial `workspaces/{workspaceId}` in Cloud Firestore (`onboardingCompleted: false`).
 * 2. Step-by-Step Onboarding Wizard (`/onboarding`) -> Configures Brand Profile, Target Channels,
 *    and Plan Selection (including Free Trial `free_trial` Rp0) -> Updates `users/{uid}`,
 *    `workspaces/{workspaceId}`, and `workspaces/{workspaceId}/brand_brain/main` in Cloud Firestore.
 * 3. Automatic Firestore Backfill on Login / Session Hydration -> Any user who previously existed
 *    only in Firebase Auth is automatically synced into Cloud Firestore `users/{uid}` & `workspaces/{workspaceId}`.
 */

import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { SUBSCRIPTION_PLANS } from './veloxa-engine';
import {
  getFirestoreInstance,
  loadSavedFirebaseConfig,
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

function buildWorkspaceIdForUid(uid: string): string {
  const clean = uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return `ws_${clean || 'tenant'}`;
}

/**
 * Ensures the authenticated user has both a `users/{uid}` document and an initial
 * `workspaces/{workspaceId}` document in Cloud Firestore (`veloxa-ai-saas`).
 * If the user already completed onboarding in Firestore, hydrates those fields into the session.
 */
export async function syncUserProfileToFirestore(
  user: VeloxaAuthenticatedUser,
  options?: {
    forceOnboardingCompleted?: boolean;
    businessName?: string;
    city?: string;
    category?: BusinessCategory;
    planId?: SubscriptionPlanId;
    selectedChannels?: SocialChannelId[];
  },
): Promise<VeloxaAuthenticatedUser> {
  const db = getFirestoreInstance();
  const workspaceId = user.activeWorkspaceId || buildWorkspaceIdForUid(user.uid);
  const nowIso = new Date().toISOString();
  const trialEndsIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (!db) {
    const updatedLocal: VeloxaAuthenticatedUser = {
      ...user,
      activeWorkspaceId: workspaceId,
      onboardingCompleted:
        options?.forceOnboardingCompleted ?? user.onboardingCompleted ?? user.isSuperAdmin,
      subscriptionPlanId: options?.planId ?? user.subscriptionPlanId ?? 'free_trial',
      businessName: options?.businessName ?? user.businessName,
      city: options?.city ?? user.city,
      category: options?.category ?? user.category,
      selectedChannels: options?.selectedChannels ?? user.selectedChannels,
    };
    persistAuthenticatedUser(updatedLocal);
    return updatedLocal;
  }

  try {
    const userRef = doc(db, 'users', user.uid);
    const existingSnap = await getDoc(userRef);

    if (existingSnap.exists()) {
      const existingData = existingSnap.data() as Record<string, unknown>;
      const resolvedOnboarding =
        options?.forceOnboardingCompleted !== undefined
          ? options.forceOnboardingCompleted
          : Boolean(existingData.onboardingCompleted ?? user.onboardingCompleted ?? user.isSuperAdmin);
      const resolvedPlan = (options?.planId ||
        (existingData.subscriptionPlanId as SubscriptionPlanId) ||
        user.subscriptionPlanId ||
        'free_trial') as SubscriptionPlanId;
      const resolvedWsId =
        (existingData.activeWorkspaceId as string) || workspaceId;
      const resolvedBusinessName =
        options?.businessName ||
        (existingData.businessName as string) ||
        user.businessName ||
        `${user.displayName} Studio`;
      const resolvedCity =
        options?.city || (existingData.city as string) || user.city || 'Jakarta';
      const resolvedCategory = (options?.category ||
        (existingData.category as BusinessCategory) ||
        user.category ||
        'cafe_fnb') as BusinessCategory;
      const resolvedChannels = (options?.selectedChannels ||
        (existingData.selectedChannels as SocialChannelId[]) ||
        user.selectedChannels || [
          'instagram',
          'facebook',
          'tiktok',
          'youtube_shorts',
        ]) as SocialChannelId[];

      const planSpec = SUBSCRIPTION_PLANS[resolvedPlan] || SUBSCRIPTION_PLANS.free_trial;

      await setDoc(
        userRef,
        {
          displayName: user.displayName.slice(0, 110),
          name: user.displayName.slice(0, 110),
          activeWorkspaceId: resolvedWsId,
          workspaceIds: [resolvedWsId],
          subscriptionPlanId: resolvedPlan,
          quotaLimit: planSpec.monthlyPostQuota,
          onboardingCompleted: resolvedOnboarding,
          businessName: resolvedBusinessName.slice(0, 110),
          city: resolvedCity.slice(0, 80),
          category: resolvedCategory,
          selectedChannels: resolvedChannels,
          updatedAt: nowIso,
        },
        { merge: true },
      );

      const hydrated: VeloxaAuthenticatedUser = {
        ...user,
        activeWorkspaceId: resolvedWsId,
        onboardingCompleted: resolvedOnboarding,
        subscriptionPlanId: resolvedPlan,
        businessName: resolvedBusinessName,
        city: resolvedCity,
        category: resolvedCategory,
        selectedChannels: resolvedChannels,
        syncedToFirestore: true,
      };
      persistAuthenticatedUser(hydrated);
      return hydrated;
    }

    // Create brand-new `users/{uid}` and `workspaces/{workspaceId}` documents in Cloud Firestore
    const initialOnboardingCompleted =
      options?.forceOnboardingCompleted ?? user.onboardingCompleted ?? user.isSuperAdmin;
    const initialPlan: SubscriptionPlanId = options?.planId || user.subscriptionPlanId || 'free_trial';
    const planSpec = SUBSCRIPTION_PLANS[initialPlan] || SUBSCRIPTION_PLANS.free_trial;
    const initialBusinessName = (
      options?.businessName ||
      user.businessName ||
      `${user.displayName} Brand`
    ).slice(0, 110);
    const initialCity = (options?.city || user.city || 'Jakarta').slice(0, 80);
    const initialCategory: BusinessCategory = options?.category || user.category || 'cafe_fnb';
    const initialChannels: SocialChannelId[] = options?.selectedChannels ||
      user.selectedChannels || ['instagram', 'facebook', 'tiktok', 'youtube_shorts'];

    await setDoc(userRef, {
      uid: user.uid,
      id: user.uid,
      email: user.email,
      displayName: user.displayName.slice(0, 110),
      name: user.displayName.slice(0, 110),
      role: user.isSuperAdmin ? 'admin' : 'user',
      provider: user.provider,
      activeWorkspaceId: workspaceId,
      workspaceIds: [workspaceId],
      subscriptionPlanId: initialPlan,
      quotaLimit: planSpec.monthlyPostQuota,
      quotaUsed: 0,
      onboardingCompleted: initialOnboardingCompleted,
      businessName: initialBusinessName,
      city: initialCity,
      category: initialCategory,
      selectedChannels: initialChannels,
      trialEndsAt: trialEndsIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const wsRef = doc(db, 'workspaces', workspaceId);
    await setDoc(
      wsRef,
      {
        id: workspaceId,
        ownerUid: user.uid,
        memberUids: [user.uid],
        name: initialBusinessName,
        category: initialCategory,
        city: initialCity,
        timezone: 'Asia/Jakarta',
        currency: 'IDR',
        subscriptionPlanId: initialPlan,
        quotaLimit: planSpec.monthlyPostQuota,
        quotaUsed: 0,
        autonomyEnabled: true,
        onboardingCompleted: initialOnboardingCompleted,
        onboardingStep: initialOnboardingCompleted ? 3 : 1,
        selectedChannels: initialChannels,
        trialEndsAt: trialEndsIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true },
    );

    const createdUser: VeloxaAuthenticatedUser = {
      ...user,
      activeWorkspaceId: workspaceId,
      onboardingCompleted: initialOnboardingCompleted,
      subscriptionPlanId: initialPlan,
      businessName: initialBusinessName,
      city: initialCity,
      category: initialCategory,
      selectedChannels: initialChannels,
      syncedToFirestore: true,
    };
    persistAuthenticatedUser(createdUser);
    return createdUser;
  } catch {
    const fallbackUser: VeloxaAuthenticatedUser = {
      ...user,
      activeWorkspaceId: workspaceId,
      onboardingCompleted:
        options?.forceOnboardingCompleted ?? user.onboardingCompleted ?? user.isSuperAdmin,
      subscriptionPlanId: options?.planId ?? user.subscriptionPlanId ?? 'free_trial',
    };
    persistAuthenticatedUser(fallbackUser);
    return fallbackUser;
  }
}

function mapFirebaseUser(user: User, fallbackEmail?: string, customName?: string): VeloxaAuthenticatedUser {
  const email = (user.email || fallbackEmail || 'tenant@veloxa.ai').trim().toLowerCase();
  const isSuper = email === SUPER_ADMIN_EMAIL;
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
 * in Cloud Firestore with `onboardingCompleted: false` and `subscriptionPlanId: 'free_trial'`.
 */
export async function registerNewVeloxaAccount(params: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: VeloxaAuthenticatedUser; isNewRegistration: boolean }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.name.trim() || cleanEmail.split('@')[0] || 'Founder Bisnis';
  const isSuper = cleanEmail === SUPER_ADMIN_EMAIL;
  const auth = getFirebaseAuthInstance();

  if (auth && params.password.length >= 6) {
    try {
      const created = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
      try {
        await updateProfile(created.user, { displayName: cleanName });
      } catch {
        // ignore profile display name update error
      }
      const mapped = mapFirebaseUser(created.user, cleanEmail, cleanName);
      const synced = await syncUserProfileToFirestore(mapped, {
        forceOnboardingCompleted: isSuper ? true : false,
        planId: 'free_trial',
      });
      return { user: synced, isNewRegistration: true };
    } catch {
      // If email already exists in Firebase Auth (e.g., user registered earlier when Firestore wasn't synced),
      // sign them in and immediately backfill their Firestore `users/{uid}` & `workspaces/{workspaceId}`!
      const signedIn = await signInWithEmailAndPassword(auth, cleanEmail, params.password);
      if (cleanName && !signedIn.user.displayName) {
        try {
          await updateProfile(signedIn.user, { displayName: cleanName });
        } catch {
          // ignore
        }
      }
      const mapped = mapFirebaseUser(signedIn.user, cleanEmail, cleanName);
      const synced = await syncUserProfileToFirestore(mapped, {
        forceOnboardingCompleted: isSuper ? true : false,
        planId: 'free_trial',
      });
      return { user: synced, isNewRegistration: true };
    }
  }

  const fallbackUid = `usr_${Date.now().toString(36)}`;
  const localUser: VeloxaAuthenticatedUser = {
    uid: fallbackUid,
    email: cleanEmail,
    displayName: cleanName,
    role: isSuper ? 'admin' : 'user',
    provider: 'email_password',
    isSuperAdmin: isSuper,
    onboardingCompleted: isSuper ? true : false,
    activeWorkspaceId: buildWorkspaceIdForUid(fallbackUid),
    subscriptionPlanId: 'free_trial',
  };
  persistAuthenticatedUser(localUser);
  return { user: localUser, isNewRegistration: true };
}

/**
 * Completes the 3-step Onboarding Wizard (`/onboarding`) and writes the full
 * brand profile, selected channels, and chosen plan (including `free_trial`)
 * to Cloud Firestore (`users/{uid}`, `workspaces/{workspaceId}`, and `workspaces/{workspaceId}/brand_brain/main`).
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
  const current = getInitialAuthenticatedUser();
  const auth = getFirebaseAuthInstance();
  const fbUser = auth?.currentUser;

  const baseUser: VeloxaAuthenticatedUser = current || {
    uid: fbUser?.uid || `usr_${Date.now().toString(36)}`,
    email: fbUser?.email || 'founder@bisnisanda.id',
    displayName: fbUser?.displayName || params.businessName,
    role: 'user',
    provider: 'email_password',
    isSuperAdmin: false,
  };

  const workspaceId = baseUser.activeWorkspaceId || buildWorkspaceIdForUid(baseUser.uid);
  const planSpec = SUBSCRIPTION_PLANS[params.planId] || SUBSCRIPTION_PLANS.free_trial;
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

  const syncedUser = await syncUserProfileToFirestore(baseUser, {
    forceOnboardingCompleted: true,
    businessName: params.businessName.trim(),
    city: params.city.trim(),
    category: params.category,
    planId: params.planId,
    selectedChannels: params.selectedChannels,
  });

  const db = getFirestoreInstance();
  if (db) {
    try {
      const wsRef = doc(db, 'workspaces', workspaceId);
      await setDoc(
        wsRef,
        {
          id: workspaceId,
          ownerUid: syncedUser.uid,
          memberUids: [syncedUser.uid],
          name: params.businessName.trim().slice(0, 110),
          category: params.category,
          city: params.city.trim().slice(0, 80),
          targetAudience: params.targetAudience.trim().slice(0, 500),
          toneOfVoice: params.brandTone.trim().slice(0, 250),
          primaryColor: '#EC749B',
          accentColor: '#171717',
          timezone: 'Asia/Jakarta',
          currency: 'IDR',
          subscriptionPlanId: params.planId,
          quotaLimit: planSpec.monthlyPostQuota,
          quotaUsed: 0,
          autonomyEnabled: true,
          onboardingCompleted: true,
          onboardingStep: 3,
          selectedChannels: params.selectedChannels,
          updatedAt: nowIso,
        },
        { merge: true },
      );

      const brandBrainRef = doc(db, 'workspaces', workspaceId, 'brand_brain', 'main');
      await setDoc(
        brandBrainRef,
        {
          id: 'main',
          workspaceId,
          brandName: params.businessName.trim().slice(0, 110),
          tagline: `Studio Otonom ${params.businessName.trim()} (${params.city.trim()})`,
          description: `Profil Brand Brain AI untuk ${params.businessName.trim()} di ${params.city.trim()}.`,
          category: params.category,
          targetAudience: params.targetAudience.trim().slice(0, 1000),
          toneOfVoice: params.brandTone.trim().slice(0, 400),
          primaryColor: '#EC749B',
          accentColor: '#171717',
          updatedBy: syncedUser.uid,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true },
      );
    } catch {
      // non-blocking if offline
    }
  }

  return syncedUser;
}

export async function signInWithEmailPasswordOrRegister(params: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<VeloxaAuthenticatedUser> {
  const cleanEmail = params.email.trim().toLowerCase();
  const isSuper = cleanEmail === SUPER_ADMIN_EMAIL;
  const auth = getFirebaseAuthInstance();

  if (auth && params.password.length >= 6) {
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, params.password);
      const mapped = mapFirebaseUser(cred.user, cleanEmail, params.displayName);
      // Automatically sync or backfill `users/{uid}` & `workspaces/{workspaceId}` in Cloud Firestore!
      const synced = await syncUserProfileToFirestore(mapped);
      return synced;
    } catch {
      try {
        const created = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
        if (params.displayName?.trim()) {
          try {
            await updateProfile(created.user, { displayName: params.displayName.trim() });
          } catch {
            // ignore
          }
        }
        const mapped = mapFirebaseUser(created.user, cleanEmail, params.displayName);
        const synced = await syncUserProfileToFirestore(mapped, {
          forceOnboardingCompleted: isSuper ? true : false,
          planId: 'free_trial',
        });
        return synced;
      } catch {
        // fallback below
      }
    }
  }

  const fallbackUid = `usr_${Date.now()}`;
  const localUser: VeloxaAuthenticatedUser = {
    uid: fallbackUid,
    email: cleanEmail,
    displayName:
      params.displayName?.trim() ||
      (isSuper ? 'Super Admin Veloxa AI' : cleanEmail.split('@')[0] || 'Tenant Veloxa'),
    role: isSuper ? 'admin' : 'user',
    provider: 'email_password',
    isSuperAdmin: isSuper,
    onboardingCompleted: true,
    activeWorkspaceId: buildWorkspaceIdForUid(fallbackUid),
    subscriptionPlanId: isSuper ? 'pro_1500k' : 'free_trial',
  };
  persistAuthenticatedUser(localUser);
  return localUser;
}

export async function signInWithGooglePopup(options?: {
  isRegistrationFlow?: boolean;
}): Promise<VeloxaAuthenticatedUser> {
  const auth = getFirebaseAuthInstance();
  if (auth) {
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      const mapped = mapFirebaseUser(cred.user);
      const synced = await syncUserProfileToFirestore(
        mapped,
        options?.isRegistrationFlow && !mapped.isSuperAdmin
          ? { forceOnboardingCompleted: false, planId: 'free_trial' }
          : undefined,
      );
      return synced;
    } catch {
      try {
        const anon = await signInAnonymously(auth);
        const fallback: VeloxaAuthenticatedUser = {
          uid: anon.user.uid,
          email: 'founder@veloxa-brand.id',
          displayName: 'Founder Brand (Google OAuth)',
          role: 'user',
          provider: 'google',
          isSuperAdmin: false,
          onboardingCompleted: options?.isRegistrationFlow ? false : true,
          activeWorkspaceId: buildWorkspaceIdForUid(anon.user.uid),
          subscriptionPlanId: 'free_trial',
        };
        const synced = await syncUserProfileToFirestore(fallback, {
          forceOnboardingCompleted: options?.isRegistrationFlow ? false : true,
          planId: 'free_trial',
        });
        return synced;
      } catch {
        // fallback below
      }
    }
  }
  const fallback: VeloxaAuthenticatedUser = {
    uid: 'usr_google_demo',
    email: 'founder@veloxa-brand.id',
    displayName: 'Founder Brand (Google OAuth)',
    role: 'user',
    provider: 'google',
    isSuperAdmin: false,
    onboardingCompleted: options?.isRegistrationFlow ? false : true,
    activeWorkspaceId: 'ws_google_demo',
    subscriptionPlanId: 'free_trial',
  };
  persistAuthenticatedUser(fallback);
  return fallback;
}

export function signInQuickRoleSession(targetRole: 'admin' | 'user'): VeloxaAuthenticatedUser {
  if (targetRole === 'admin') {
    const adminUser: VeloxaAuthenticatedUser = {
      uid: 'usr_owner_sosrospg',
      email: SUPER_ADMIN_EMAIL,
      displayName: 'Owner Veloxa AI (sosrospg)',
      role: 'admin',
      provider: 'super_admin_session',
      isSuperAdmin: true,
      onboardingCompleted: true,
      activeWorkspaceId: 'ws_super_admin',
      subscriptionPlanId: 'pro_1500k',
    };
    persistAuthenticatedUser(adminUser);
    return adminUser;
  }
  const tenantUser: VeloxaAuthenticatedUser = {
    uid: 'usr_tenant_nusantara',
    email: 'owner@nusantararun.id',
    displayName: 'Dimas Pratama (Nusantara Run)',
    role: 'user',
    provider: 'demo_tenant',
    isSuperAdmin: false,
    onboardingCompleted: true,
    activeWorkspaceId: 'ws_nusantara_run',
    subscriptionPlanId: 'pro_1500k',
    businessName: 'Nusantara Run Festival',
    city: 'Bandung',
    category: 'running_event',
  };
  persistAuthenticatedUser(tenantUser);
  return tenantUser;
}

export async function signOutVeloxaUser(): Promise<null> {
  const auth = getFirebaseAuthInstance();
  if (auth) {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
  }
  persistAuthenticatedUser(null);
  return null;
}

export function subscribeToFirebaseAuthChanges(
  callback: (user: VeloxaAuthenticatedUser | null) => void,
): () => void {
  const auth = getFirebaseAuthInstance();
  if (!auth) return () => {};
  return onAuthStateChanged(auth, (fbUser) => {
    if (fbUser && !fbUser.isAnonymous) {
      const mapped = mapFirebaseUser(fbUser);
      // Immediately backfill/sync the Firebase Auth user into Cloud Firestore `users/{uid}` & `workspaces/{workspaceId}`
      void syncUserProfileToFirestore(mapped).then((synced) => {
        callback(synced);
      });
    }
  });
}

export async function sendVeloxaPasswordReset(email: string): Promise<{
  ok: boolean;
  email: string;
  deliveredViaFirebase: boolean;
  resetReferenceCode: string;
}> {
  const cleanEmail = email.trim().toLowerCase();
  const auth = getFirebaseAuthInstance();
  const resetReferenceCode = `VLX-RST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  if (auth && cleanEmail.includes('@')) {
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      return {
        ok: true,
        email: cleanEmail,
        deliveredViaFirebase: true,
        resetReferenceCode,
      };
    } catch {
      // Fallback if user is a local-first demo tenant or email enumeration protection is active
    }
  }

  return {
    ok: true,
    email: cleanEmail,
    deliveredViaFirebase: false,
    resetReferenceCode,
  };
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
