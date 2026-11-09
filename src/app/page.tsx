'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import StudioMediaPreview from '@/components/StudioMediaPreview';
import { VeloxaBrandWorkspace } from '@/components/VeloxaBrandWorkspace';
import { normalizeBrandProfile } from '@/lib/veloxa-brand-profile';
import { VeloxaStudioComposer } from '@/components/VeloxaStudioComposer';
import { ContentGenerationError, type GenerationFeedback, type GenerationStage } from '@/lib/content-generation';
import PublishReviewDialog from '@/components/PublishReviewDialog';
import { useRouter } from 'next/navigation';
import {
  BRAND_PRESETS,
  SUBSCRIPTION_PLANS,
  buildMetaAdCampaignPlan,
  calculatePlatformAdminMetrics,
  calculateTenantUnitEconomics,
  canConsumePostingQuota,
  computeEventCampaignPhase,
  generateBrandContentDraft,
  runMetaAdsAutonomousOptimizer,
} from '@/lib/veloxa-engine';
import {
  calculateFirestoreCostSavingsPct,
  getInitialLocalFirstTelemetry,
  type LocalFirstTelemetry,
} from '@/lib/veloxa-local-first';
import { VELOXA_OPENAI_AGENTS } from '@/lib/veloxa-openai-agents';
import {
  buildRealInitialWorkspaceSnapshot,
  getDefaultFirebaseConnectionConfig,
  loadAllRealTenantsFromFirestore,
  loadSavedFirebaseConfig,
  loadWorkspaceSnapshotFromStore,
  saveChannelConnectionToFirestore,
  saveFirebaseConnectionConfig,
  syncWorkspaceSnapshotToStore,
  type VeloxaFirebaseConnectionConfig,
} from '@/lib/veloxa-firestore-repo';
import {
  INITIAL_AUTONOMY_CONFIG,
  INITIAL_CENTRAL_CREDENTIALS,
  INITIAL_CHANNEL_CONNECTIONS,
  INITIAL_EVENT_CAMPAIGNS,
  INITIAL_META_ADS_ACCOUNT,
  INITIAL_TENANT_WORKSPACES,
  INITIAL_VAULT_ASSETS,
  buildInitialDrafts,
  buildInitialMetaAdCampaigns,
} from '@/lib/veloxa-seed-data';
import { getCentralOAuthCallbackUri, pickBrandAssetFromDevice } from '@/lib/veloxa-mobile-bridge';
import {
  buildSocialProfileUrl,
  normalizeSocialHandle,
} from '@/lib/veloxa-social-publisher';
import {
  buildRenderedVisualSvgDataUrl,
  downloadDraftPosterSvg,
  speakDraftVoiceoverIndonesian,
} from '@/lib/veloxa-visual-renderer';
import {
  SUPER_ADMIN_EMAIL,
  consumePendingRegistrationBrand,
  getInitialAuthenticatedUser,
  signInQuickRoleSession,
  signInWithEmailPasswordOrRegister,
  signInWithGooglePopup,
  signOutVeloxaUser,
  subscribeToFirebaseAuthChanges,
  syncUserProfileToFirestore,
  type VeloxaAuthenticatedUser,
} from '@/lib/veloxa-auth';
import {
  VELOXA_I18N_COPY,
  VELOXA_LOCALES,
  loadSavedVeloxaLocale,
  saveVeloxaLocale,
  type VeloxaLocale,
} from '@/lib/veloxa-i18n';
import { VeloxaMetaConnections } from '@/components/VeloxaMetaConnections';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { VeloxaPublicLanding } from '@/components/VeloxaPublicLanding';
import { VeloxaPublicHeader } from '@/components/VeloxaPublicHeader';
import { VeloxaWorkspaceOverview } from '@/components/VeloxaWorkspaceOverview';
import { VeloxaWorkspaceShell } from '@/components/VeloxaWorkspaceShell';
import type {
  AutonomyConfig,
  BrandProfile,
  BrandVaultAsset,
  BusinessCategory,
  CentralPlatformCredentials,
  ChannelConnectionState,
  ContentDraft,
  ContentFormat,
  EventCampaign,
  MetaAdCampaignPlan,
  MetaAdObjective,
  MetaAdsAccountConnection,
  SocialChannelId,
  SubscriptionPlanId,
  TenantWorkspaceSummary,
  VeloxaRole,
} from '@/lib/veloxa-types';
import {
  Bot,
  Camera,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  Flame,
  LayoutDashboard,
  Lock,
  Megaphone,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
  Zap,
} from 'lucide-react';

type UserTabId = 'overview' | 'brand_vault' | 'studio' | 'autonomy' | 'meta_ads';

const CHANNEL_META: Record<
  SocialChannelId,
  { label: string; shortLabel: string; badgeClass: string; supportsPhoto: boolean; supportsVideo: boolean }
> = {
  instagram: {
    label: 'Instagram (Reels & Feed)',
    shortLabel: 'Instagram',
    badgeClass: 'bg-white text-neutral-700 border-neutral-200',
    supportsPhoto: true,
    supportsVideo: true,
  },
  facebook: {
    label: 'Facebook Page & Reels',
    shortLabel: 'Facebook',
    badgeClass: 'bg-white text-neutral-700 border-neutral-200',
    supportsPhoto: true,
    supportsVideo: true,
  },
  tiktok: {
    label: 'TikTok (Video & Photo Mode)',
    shortLabel: 'TikTok',
    badgeClass: 'bg-white text-neutral-700 border-neutral-200',
    supportsPhoto: true,
    supportsVideo: true,
  },
  youtube_shorts: {
    label: 'YouTube Shorts (9:16)',
    shortLabel: 'YT Shorts',
    badgeClass: 'bg-white text-neutral-700 border-neutral-200',
    supportsPhoto: false,
    supportsVideo: true,
  },
};

function formatIdr(value: number): string {
  return 'Rp' + Math.round(value).toLocaleString('id-ID');
}

export default function VeloxaAiPlatformPage() {
  const router = useRouter();
  const [activeRole, setActiveRole] = useState<VeloxaRole>('user');
  const [activeTab, setActiveTab] = useState<UserTabId>('overview');
  const [selectedPresetKey, setSelectedPresetKey] = useState<'running_event' | 'cafe_fnb' | 'clinic_beauty' | 'custom'>('running_event');

  // Multi-tenant workspace state
  const [brand, setBrand] = useState<BrandProfile>(BRAND_PRESETS.running_event);
  const [activePlanId, setActivePlanId] = useState<SubscriptionPlanId>('free_trial');
  const [postsUsedThisMonth, setPostsUsedThisMonth] = useState<number>(0);
  const [connections, setConnections] = useState<ChannelConnectionState[]>(INITIAL_CHANNEL_CONNECTIONS.map(connection => ({ ...connection, connected: false, handle: '', accountName: 'Belum Terhubung', followerCount: 0, tokenExpiresAt: null, oauthMode: 'disconnected', lastPublishedAt: null })));
  const [connectionsVerified, setConnectionsVerified] = useState(false);
  const [metaAccount, setMetaAccount] = useState<MetaAdsAccountConnection>(INITIAL_META_ADS_ACCOUNT);
  const [vaultAssets, setVaultAssets] = useState<BrandVaultAsset[]>([]);
  const [autonomyConfig, setAutonomyConfig] = useState<AutonomyConfig>(INITIAL_AUTONOMY_CONFIG);
  const [eventCampaigns, setEventCampaigns] = useState<EventCampaign[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [metaAdCampaigns, setMetaAdCampaigns] = useState<MetaAdCampaignPlan[]>([]);

  // Studio form state
  const [studioFormat, setStudioFormat] = useState<ContentFormat>('single_post');
  const [isCreatingContent, setIsCreatingContent] = useState(false);
  const [generationFeedback, setGenerationFeedback] = useState<GenerationFeedback | null>(null);
  const generationAttempt = useRef<object | null>(null);
  const hydrationEpoch = useRef(0);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null);
  const [publishReviewDraftId, setPublishReviewDraftId] = useState<string | null>(null);
  const [reviewOAuthAccounts, setReviewOAuthAccounts] = useState(false);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [referenceInstruction, setReferenceInstruction] = useState('');
  useEffect(() => { setSelectedReferenceIds([]); setReferenceInstruction(''); }, [brand.workspaceId]);
  const [studioTopic, setStudioTopic] = useState<string>('');
  const [studioFilter, setStudioFilter] = useState<'all' | 'draft' | 'published' | 'attention'>('all');

  // Event campaign creator state
  const [newCampaignName, setNewCampaignName] = useState<string>('');
  const [newCampaignDate, setNewCampaignDate] = useState<string>('2026-12-15');
  const [newCampaignHighlight, setNewCampaignHighlight] = useState<string>('');

  // AI Meta Ads Architect form state
  const [adObjective, setAdObjective] = useState<MetaAdObjective>('WHATSAPP_MESSAGES');
  const [adPromoTitle, setAdPromoTitle] = useState<string>(
    BRAND_PRESETS.running_event.offerings[0].title,
  );
  const [adDailyBudgetIdr, setAdDailyBudgetIdr] = useState<number>(150_000);
  const [adDurationDays, setAdDurationDays] = useState<number>(10);
  const [adCity, setAdCity] = useState<string>('Bandung');
  const [adRadiusKm, setAdRadiusKm] = useState<number>(25);
  const [adAgeMin, setAdAgeMin] = useState<number>(19);
  const [adAgeMax, setAdAgeMax] = useState<number>(44);
  const [adCustomInterest, setAdCustomInterest] = useState<string>('Marathon & Garmin');

  // Super Admin & Local-First Telemetry state
  const [tenants, setTenants] = useState<TenantWorkspaceSummary[]>([]);
  const [centralCreds] = useState<CentralPlatformCredentials>(INITIAL_CENTRAL_CREDENTIALS);
  const [firebaseCfg, setFirebaseCfg] = useState<VeloxaFirebaseConnectionConfig>(() =>
    getDefaultFirebaseConnectionConfig(),
  );
  const [localTelemetry, setLocalTelemetry] = useState<LocalFirstTelemetry>(() =>
    getInitialLocalFirstTelemetry(),
  );
  const [openAiInputKey, setOpenAiInputKey] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string>(
    '',
  );

  // Stage 1-5 Native <dialog> Modal Refs (modern-web-guidance: dialog)
  const onboardingDialogRef = useRef<HTMLDialogElement | null>(null);
  const oauthDialogRef = useRef<HTMLDialogElement | null>(null);
  const billingDialogRef = useRef<HTMLDialogElement | null>(null);
  const authDialogRef = useRef<HTMLDialogElement | null>(null);
  const logoutConfirmDialogRef = useRef<HTMLDialogElement | null>(null);
  const hasHydratedCloudWorkspaceRef = useRef<string | null>(null);

  // Stage 5A & 5B: Production Authentication, Role Separation & Global i18n State
  const [locale, setLocale] = useState<VeloxaLocale>('id');
  const [authUser, setAuthUser] = useState<VeloxaAuthenticatedUser | null>(null);
  useEffect(() => { generationAttempt.current = null; setIsCreatingContent(false); setGenerationFeedback(null); }, [authUser?.uid, brand.workspaceId]);

  const [authEmailInput, setAuthEmailInput] = useState<string>('');
  const [authPasswordInput, setAuthPasswordInput] = useState<string>('');

  const handleSelectLocale = (nextLocale: VeloxaLocale) => {
    setLocale(nextLocale);
    saveVeloxaLocale(nextLocale);
  };

  // Stage 1: New Business Onboarding Form State
  const [onboardBusinessName, setOnboardBusinessName] = useState<string>('');
  const [onboardCity, setOnboardCity] = useState<string>('Bandung');
  const [onboardCategory, setOnboardCategory] = useState<BusinessCategory>('cafe_fnb');
  const [onboardOfferingTitle, setOnboardOfferingTitle] = useState<string>('');
  const [onboardOwnerEmail, setOnboardOwnerEmail] = useState<string>('owner@bisnisbaru.id');
  const [onboardPlanId, setOnboardPlanId] = useState<SubscriptionPlanId>('growth_1000k');

  // Stage 2: Studio Voiceover Playback State
  const [playingVoiceoverDraftId, setPlayingVoiceoverDraftId] = useState<string | null>(null);

  // Stage 3: OAuth & Meta Ads Customizer State
  const [editingChannel, setEditingChannel] = useState<SocialChannelId>('facebook');
  const [editingChannelHandle, setEditingChannelHandle] = useState<string>('');
  const [editingChannelAccountName, setEditingChannelAccountName] = useState<string>('');
  const [editingChannelFollowers, setEditingChannelFollowers] = useState<number>(0);
  const [editingChannelAccessToken, setEditingChannelAccessToken] = useState<string>('');
  const [editingMetaAdAccountId, setEditingMetaAdAccountId] = useState<string>('');
  const [oauthPopupStatus, setOauthPopupStatus] = useState<string | null>(null);

  // Stage 4: Billing & QRIS Checkout State
  const [selectedCheckoutPlanId, setSelectedCheckoutPlanId] =
    useState<SubscriptionPlanId>('pro_1500k');
  const [paymentMethodTab, setPaymentMethodTab] = useState<'qris' | 'va_bca'>('qris');
  const [billingReceipts, setBillingReceipts] = useState<
    Array<{ id: string; workspaceName: string; planName: string; amountIdr: number; paidAtWib: string }>
  >([]);

  useEffect(() => {
    setLocale(loadSavedVeloxaLocale());
    const savedCfg = loadSavedFirebaseConfig();
    setFirebaseCfg(savedCfg);

    const applySnapshotToState = (snap: NonNullable<Awaited<ReturnType<typeof loadWorkspaceSnapshotFromStore>>['snapshot']>) => {
      setBrand(snap.brand);
      setActivePlanId(snap.activePlanId);
      setPostsUsedThisMonth(snap.postsUsedThisMonth);
      setConnections(snap.connections);
      setMetaAccount({ ...snap.metaAccount, connected: false });
      setVaultAssets(snap.vaultAssets);
      setAutonomyConfig({ ...snap.autonomyConfig, enabled: false });
      setEventCampaigns(snap.eventCampaigns);
      setDrafts(snap.drafts);
      setMetaAdCampaigns(snap.metaAdCampaigns);
      if (snap.tenants && snap.tenants.length > 0) {
        setTenants(snap.tenants);
      }
      setAdCity(snap.brand.city);
      setAdPromoTitle(`Kampanye ${snap.brand.businessName} (${snap.brand.city})`);
      hasHydratedCloudWorkspaceRef.current = snap.brand.workspaceId;
    };

    const hydrateForAuthenticatedUser = async (user: VeloxaAuthenticatedUser, epoch: number) => {
      if (!user.isSuperAdmin && user.onboardingCompleted === false) {
        router.push('/onboarding');
        return;
      }

      setConnectionsVerified(false);
      const targetWsId =
        user.activeWorkspaceId || `ws_${encodeURIComponent(user.uid)}`;

      const { snapshot: cloudSnap, telemetry } = await loadWorkspaceSnapshotFromStore(
        targetWsId,
        savedCfg,
        { forceCloudPull: true },
      );
      if (epoch !== hydrationEpoch.current) return;
      setLocalTelemetry(telemetry);

      if (cloudSnap) {
        applySnapshotToState(cloudSnap);
      } else {
        const builtSnap = buildRealInitialWorkspaceSnapshot({
          workspaceId: targetWsId,
          businessName: user.businessName || user.displayName || 'Bisnis Anda',
          city: user.city || 'Jakarta',
          category: user.category || 'cafe_fnb',
          targetAudience: user.targetAudience,
          brandTone: user.brandTone,
          selectedChannels: user.selectedChannels,
          planId: user.subscriptionPlanId || 'free_trial',
          ownerName: user.displayName,
          ownerEmail: user.email,
        });
        applySnapshotToState(builtSnap);
        void syncWorkspaceSnapshotToStore(builtSnap, savedCfg, { forceCloudPush: true });
      }

      const [metaResult, contentResult, mediaResult] = await Promise.allSettled([
        veloxaApi<{ connections: ChannelConnectionState[] }>(`/api/veloxa/meta/accounts?workspaceId=${encodeURIComponent(targetWsId)}`),
        veloxaApi<{ drafts: ContentDraft[]; quotaUsed: number }>(`/api/veloxa/content?workspaceId=${encodeURIComponent(targetWsId)}`),
        veloxaApi<{ assets: BrandVaultAsset[] }>(`/api/veloxa/media?workspaceId=${encodeURIComponent(targetWsId)}&includeTrash=1`),
      ]);
      if (epoch !== hydrationEpoch.current) return;
      const resourceIssues: string[] = [];
      if (metaResult.status === 'fulfilled') {
        const meta = metaResult.value;
        setConnectionsVerified(true);
        setConnections(INITIAL_CHANNEL_CONNECTIONS.map(connection => meta.connections.find(item => item.channel === connection.channel) || { ...connection, connected: false, handle: '', accountName: 'Belum Terhubung', followerCount: 0, tokenExpiresAt: null, oauthMode: 'disconnected', lastPublishedAt: null }));
      } else {
        // Keep the last known account metadata. A failed check is not a disconnect.
        setConnectionsVerified(false);
        resourceIssues.push('Status akun sosial belum dapat diperiksa. Muat ulang halaman untuk mencoba lagi.');
      }
      if (contentResult.status === 'fulfilled') {
        const content = contentResult.value;
        setDrafts(previous => [...content.drafts, ...previous.filter(draft => !content.drafts.some(item => item.id === draft.id)).map(draft => draft.renderedMedia ? draft : { ...draft, status: 'draft' as const, publishedAtWib: undefined, channelStatuses: draft.channelStatuses.map(item => ({ channel: item.channel, status: 'pending' as const })) })]);
        setPostsUsedThisMonth(content.quotaUsed);
      } else resourceIssues.push('Koleksi konten belum dapat diperbarui.');
      if (mediaResult.status === 'fulfilled') setVaultAssets(mediaResult.value.assets);
      else {
        setVaultAssets([]); setSelectedReferenceIds([]);
        resourceIssues.push('Galeri foto belum dapat dimuat. Coba Muat ulang di Profil & aset.');
      }
      if (resourceIssues.length) setStatusBanner(resourceIssues.join(' '));
      if (epoch !== hydrationEpoch.current) return;
      const callback = new URL(window.location.href);
      if (callback.searchParams.has('meta') || callback.searchParams.has('instagram')) {
        const directInstagram = callback.searchParams.has('instagram');
        setEditingChannel(directInstagram ? 'instagram' : 'facebook');
        setReviewOAuthAccounts(true);
        setStatusBanner((directInstagram ? callback.searchParams.get('instagram') : callback.searchParams.get('meta')) === 'failed'
          ? 'Koneksi belum berhasil. Periksa izin akun dan coba kembali.'
          : 'Periksa daftar akun yang diverifikasi server, lalu pilih akun tujuan workspace ini.');
        oauthDialogRef.current?.showModal();
        callback.searchParams.delete('meta'); callback.searchParams.delete('instagram'); window.history.replaceState({}, '', callback.toString());
      }
      if (user.isSuperAdmin) {
        const realTenants = await loadAllRealTenantsFromFirestore(savedCfg);
        if (epoch === hydrationEpoch.current) setTenants(realTenants);
      }
    };

    const pendingReg = consumePendingRegistrationBrand();

    if (pendingReg) {
      setStatusBanner(
        `Selamat datang di Veloxa AI! Workspace "${pendingReg.businessName}" (${pendingReg.city}) telah tersimpan ke Cloud Firestore.`,
      );
    }

    let active = true;
    const unsubAuth = subscribeToFirebaseAuthChanges((fbUser) => {
      if (!active) return;
      const epoch = ++hydrationEpoch.current;
      setIsWorkspaceLoading(!!fbUser);
      setAuthUser(fbUser);
      setActiveRole(fbUser?.isSuperAdmin ? 'admin' : 'user');
      if (fbUser) void hydrateForAuthenticatedUser(fbUser, epoch).catch(error => {
        if (active && epoch === hydrationEpoch.current) setStatusBanner(error instanceof Error ? error.message : 'Workspace belum dapat dimuat.');
      }).finally(() => { if (active && epoch === hydrationEpoch.current) setIsWorkspaceLoading(false); });
      else hasHydratedCloudWorkspaceRef.current = null;
    }, error => setStatusBanner(error instanceof Error ? error.message : 'Sesi belum dapat diverifikasi.'));

    return () => { active = false; hydrationEpoch.current++; unsubAuth(); };
  }, [router]);

  useEffect(() => {
    if (!authUser || hasHydratedCloudWorkspaceRef.current !== brand.workspaceId) {
      return;
    }
    void syncWorkspaceSnapshotToStore(
      {
        brand,
        activePlanId,
        postsUsedThisMonth,
        connections,
        metaAccount,
        vaultAssets,
        autonomyConfig,
        eventCampaigns,
        drafts,
        metaAdCampaigns,
        tenants,
        updatedAtIso: new Date().toISOString(),
      },
      firebaseCfg,
      { forceCloudPush: true },
    ).then((res) => {
      setLocalTelemetry(res.telemetry);
    });
  }, [
    authUser,
    brand,
    activePlanId,
    postsUsedThisMonth,
    connections,
    metaAccount,
    vaultAssets,
    autonomyConfig,
    eventCampaigns,
    drafts,
    metaAdCampaigns,
    tenants,
    firebaseCfg,
  ]);

  const currentPlan = SUBSCRIPTION_PLANS[activePlanId];
  const adminSummary = useMemo(() => calculatePlatformAdminMetrics(tenants), [tenants]);
  const firestoreSavingsPct = useMemo(
    () => calculateFirestoreCostSavingsPct(localTelemetry),
    [localTelemetry],
  );

  const handleForceCloudSync = async () => {
    const res = await syncWorkspaceSnapshotToStore(
      {
        brand,
        activePlanId,
        postsUsedThisMonth,
        connections,
        metaAccount,
        vaultAssets,
        autonomyConfig,
        eventCampaigns,
        drafts,
        metaAdCampaigns,
        tenants,
        updatedAtIso: new Date().toISOString(),
      },
      firebaseCfg,
      { forceCloudPush: true },
    );
    setLocalTelemetry(res.telemetry);
    setStatusBanner(
      res.syncedToFirestore
        ? `Snapshot Local-First (${res.telemetry.lastPayloadHash}) berhasil disinkronkan ke Cloud Firestore (veloxa-ai-saas)!`
        : `Perubahan baru tersimpan di perangkat ini dan belum tersinkron ke cloud. Periksa koneksi sebelum melanjutkan.`,
    );
  };

  const handleCompleteNewBusinessOnboarding = (e: React.FormEvent) => {
    e.preventDefault();
    onboardingDialogRef.current?.close();
    router.push(authUser ? '/onboarding' : '/register');
  };

  const handleSaveBrandProfile = async (value: BrandProfile) => {
    if (value.workspaceId !== brand.workspaceId) throw new Error('Workspace berubah. Buka kembali profil yang ingin disimpan.');
    const epoch = hydrationEpoch.current; const next = normalizeBrandProfile(value);
    const result = await syncWorkspaceSnapshotToStore({ brand: next, activePlanId, postsUsedThisMonth, connections, metaAccount, vaultAssets, autonomyConfig, eventCampaigns, drafts, metaAdCampaigns, tenants, updatedAtIso: new Date().toISOString() }, firebaseCfg, { forceCloudPush: true });
    if (!result.syncedToFirestore) throw new Error('Profil belum tersimpan ke cloud. Isian Anda tetap ada; periksa koneksi lalu simpan lagi.');
    if (epoch !== hydrationEpoch.current) throw new Error('Workspace berubah. Muat ulang untuk memeriksa profil tersimpan.');
    setBrand(next); setLocalTelemetry(result.telemetry);
  };
  const handleReloadBrandPhotos = async () => {
    const epoch = hydrationEpoch.current;
    const result = await veloxaApi<{ assets: BrandVaultAsset[] }>(`/api/veloxa/media?workspaceId=${encodeURIComponent(brand.workspaceId)}&includeTrash=1`);
    if (epoch !== hydrationEpoch.current) throw new Error('Workspace berubah. Buka kembali galeri foto.');
    setVaultAssets(result.assets);
    setSelectedReferenceIds(previous => previous.filter(id => result.assets.some(asset => asset.id === id && !asset.trashedAt)));
  };
  const handleUploadBrandPhoto = async (file: File, title: string) => {
    const epoch = hydrationEpoch.current;
    const form = new FormData(); form.set('workspaceId', brand.workspaceId); form.set('file', file); form.set('title', title);
    const result = await veloxaApi<{ asset: BrandVaultAsset }>('/api/veloxa/media', { method: 'POST', body: form });
    if (epoch !== hydrationEpoch.current) throw new Error('Workspace berubah. Buka kembali galeri foto.');
    setVaultAssets(previous => [result.asset, ...previous.filter(asset => asset.id !== result.asset.id)]);
  };
  const handleAssetState = async (assetId: string, action: 'trash' | 'restore') => {
    const epoch = hydrationEpoch.current;
    const result = await veloxaApi<{ asset: BrandVaultAsset }>('/api/veloxa/media', { method: 'PATCH', body: JSON.stringify({ workspaceId: brand.workspaceId, assetId, action }) });
    if (epoch !== hydrationEpoch.current) throw new Error('Workspace berubah. Buka kembali galeri foto.');
    setVaultAssets(previous => previous.map(asset => asset.id === assetId ? result.asset : asset));
    if (action === 'trash') setSelectedReferenceIds(previous => previous.filter(id => id !== assetId));
  };

  const populateOAuthModalFieldsForChannel = (channel: SocialChannelId) => setEditingChannel(channel);
  const handleOpenOAuthConfigModal = (channel: SocialChannelId) => {
    setEditingChannel(channel);
    oauthDialogRef.current?.showModal();
  };

  const handleConfirmQrisSubscriptionUpgrade = async () => {
    setStatusBanner('Pembayaran belum diaktifkan. Integrasi Duitku akan tersedia kemudian; paket Anda belum berubah.');
    billingDialogRef.current?.close();
  };

  const handleEmailSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = await signInWithEmailPasswordOrRegister({ email: authEmailInput, password: authPasswordInput });
      setAuthUser(user); setActiveRole(user.isSuperAdmin ? 'admin' : 'user'); authDialogRef.current?.close();
      if (!user.onboardingCompleted && !user.isSuperAdmin) router.push('/onboarding');
    } catch (error) { setStatusBanner(error instanceof Error ? error.message : 'Login belum berhasil.'); }
  };
  const handleGoogleSignInClick = async () => {
    try {
      const user = await signInWithGooglePopup(); setAuthUser(user); setActiveRole(user.isSuperAdmin ? 'admin' : 'user'); authDialogRef.current?.close();
      if (!user.onboardingCompleted && !user.isSuperAdmin) router.push('/onboarding');
    } catch (error) { setStatusBanner(error instanceof Error ? error.message : 'Login Google belum berhasil.'); }
  };
  const handleQuickLoginRole = (_targetRole: 'admin' | 'user') => router.push('/login');

  const handleRequestSignOutClick = () => {
    logoutConfirmDialogRef.current?.showModal();
  };

  const handleConfirmSignOut = async () => {
    logoutConfirmDialogRef.current?.close();
    try {
      await signOutVeloxaUser(); hydrationEpoch.current++; hasHydratedCloudWorkspaceRef.current = null;
      setAuthUser(null); setActiveRole('user'); setIsWorkspaceLoading(false); authDialogRef.current?.close();
    } catch (error) { setStatusBanner(error instanceof Error ? error.message : 'Keluar akun belum berhasil. Silakan coba lagi.'); }
  };

  const handlePlayDraftVoiceover = (draft: ContentDraft) => {
    if (playingVoiceoverDraftId === draft.id) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setPlayingVoiceoverDraftId(null);
      return;
    }
    setPlayingVoiceoverDraftId(draft.id);
    const res = speakDraftVoiceoverIndonesian(draft, () => {
      setPlayingVoiceoverDraftId(null);
    });
    setStatusBanner(
      `Memutar pembacaan teks Bahasa Indonesia: "${res.scriptText.slice(0, 85)}..."`,
    );
  };

  const handleSelectBrandPreset = (key: 'running_event' | 'cafe_fnb' | 'clinic_beauty' | 'custom') => {
    setSelectedPresetKey(key);
    const nextBrand = BRAND_PRESETS[key];
    setBrand(authUser ? { ...nextBrand, workspaceId: brand.workspaceId } : nextBrand);
    setAdCity(nextBrand.city);
    setAdPromoTitle(nextBrand.offerings[0]?.title || nextBrand.businessName);
    setStatusBanner(`Workspace beralih ke preset "${nextBrand.businessName}" (${nextBrand.city}).`);
  };

  const handleToggleChannel = (channel: SocialChannelId) => handleOpenOAuthConfigModal(channel);

  const handleGenerateStudioDraft = async (_source: ContentDraft['source'] = 'manual_studio', scheduledSlotWib?: string) => {
    if (generationAttempt.current) return;
    if (scheduledSlotWib) { setStatusBanner('Penjadwalan belum diaktifkan. Buat dan tinjau post tunggal di Studio dahulu.'); return; }
    const attempt = {}; generationAttempt.current = attempt;
    const epoch = hydrationEpoch.current;
    const current = () => generationAttempt.current === attempt && hydrationEpoch.current === epoch;
    let stage: GenerationStage = 'sync';
    setIsCreatingContent(true); setGenerationFeedback({ status: 'running', stage });
    setStudioFilter('all');
    try {
      const saved = await syncWorkspaceSnapshotToStore({ brand, activePlanId, postsUsedThisMonth, connections, metaAccount, vaultAssets, autonomyConfig, eventCampaigns, drafts, metaAdCampaigns, tenants, updatedAtIso: new Date().toISOString() }, firebaseCfg, { forceCloudPush: true });
      if (!saved.syncedToFirestore) throw new Error('Perubahan workspace belum tersimpan ke cloud. Periksa koneksi lalu coba lagi.');
      if (!current()) return;
      stage = 'validation'; setGenerationFeedback({ status: 'running', stage });
      const result = await veloxaApi<{ draft: ContentDraft; engineMode: string }>('/api/veloxa/content', { method: 'POST', body: JSON.stringify({ workspaceId: brand.workspaceId, topic: studioTopic.trim() || `Perkenalkan ${brand.businessName} di ${brand.city}`, format: studioFormat, referenceAssetIds: selectedReferenceIds, ...(selectedReferenceIds.length ? { referenceInstruction: referenceInstruction.trim() } : {}) }) }, { onProgress: progress => { if (current()) { stage = progress.stage; setGenerationFeedback({ status: 'running', stage }); } } });
      if (!current()) return;
      setDrafts(previous => [result.draft, ...previous]); setStudioTopic('');
      setGenerationFeedback({ status: 'success', stage: 'saving', message: 'Draf berhasil dibuat. Tinjau hasilnya pada koleksi konten di bawah. Belum ada konten diterbitkan.' });
      setStatusBanner(`Draf dan media final siap ditinjau. ${result.engineMode === 'openai_live' ? 'Caption disusun dengan AI.' : 'Caption memakai template lokal; AI belum tersedia.'} Belum ada konten diterbitkan.`);
    } catch (error) {
      if (current()) setGenerationFeedback({ status: 'error', stage: error instanceof ContentGenerationError && error.stage ? error.stage : stage, message: error instanceof Error ? error.message : 'Konten belum dapat dibuat. Silakan coba lagi.', requestId: error instanceof ContentGenerationError ? error.requestId : undefined, uncertain: error instanceof ContentGenerationError ? error.uncertain : stage !== 'sync' });
    } finally { if (generationAttempt.current === attempt) { if (!current()) setGenerationFeedback(null); generationAttempt.current = null; setIsCreatingContent(false); } }
  };
  const handlePublishDraftNow = async (draftId: string) => {
    if (!publishingDraftId && drafts.some(draft => draft.id === draftId)) setPublishReviewDraftId(draftId);
  };
  const confirmPublishDraftNow = async (draftId: string) => {
    const draft = drafts.find(item => item.id === draftId);
    if (!draft || publishingDraftId) return;
    setPublishReviewDraftId(null);
    setPublishingDraftId(draftId); setStatusBanner('Mengirim konten ke Meta. Jangan menutup halaman selama proses berlangsung…');
    try {
      const result = await veloxaApi<{ draft: ContentDraft; receipts: { channel: string; status: string; error?: string }[]; quotaUsed: number }>('/api/veloxa/publish', { method: 'POST', body: JSON.stringify({ workspaceId: brand.workspaceId, draftId }) });
      setDrafts(previous => previous.map(item => item.id === draftId ? result.draft : item)); setPostsUsedThisMonth(result.quotaUsed);
      setStatusBanner(result.receipts.map(receipt => `${receipt.channel}: ${receipt.status === 'published' ? 'berhasil diterbitkan' : receipt.error || 'belum berhasil'}`).join(' · '));
    } catch (error) { setStatusBanner(error instanceof Error ? error.message : 'Publikasi belum dapat dipastikan. Periksa akun Meta sebelum mencoba ulang.'); }
    finally { setPublishingDraftId(null); }
  };

  const handleCreateEventCampaign = () => {
    if (!newCampaignName.trim()) return;
    const phaseInfo = computeEventCampaignPhase(newCampaignDate);
    const created: EventCampaign = {
      id: `camp_${Date.now()}`,
      workspaceId: brand.workspaceId,
      name: newCampaignName.trim(),
      eventDateIso: newCampaignDate,
      location: brand.city,
      ticketOrPromoHighlight:
        newCampaignHighlight.trim() || `Promo spesial ${newCampaignName.trim()} di ${brand.city}`,
      targetRegistrationsOrSales: 500,
      currentConversions: 0,
      status: 'active',
      currentPhase: phaseInfo.phase,
      autoInjectIntoDailyAutonomy: true,
    };
    setEventCampaigns((prev) => [created, ...prev]);
    setNewCampaignName('');
    setNewCampaignHighlight('');
    setStatusBanner(`Kampanye Event "${created.name}" (${phaseInfo.phaseLabel}) diaktifkan ke dalam kalender otonom!`);
  };

  const handleDesignMetaAdsWithAi = (fromOrganicDraft?: ContentDraft) => {
    try {
    const plan = buildMetaAdCampaignPlan({
      brand,
      metaAccount,
      objective: adObjective,
      promotedOfferingTitle: fromOrganicDraft ? fromOrganicDraft.title : adPromoTitle,
      requestedDailyBudgetIdr: fromOrganicDraft?.organicMetrics?.recommendedAdDailyBudgetIdr || adDailyBudgetIdr,
      durationDays: adDurationDays,
      targetCity: adCity,
      radiusKm: adRadiusKm,
      ageMin: adAgeMin,
      ageMax: adAgeMax,
      customInterestKeyword: adCustomInterest,
      originatedFromOrganicDraft: fromOrganicDraft,
    });
    setMetaAdCampaigns((prev) => [plan, ...prev]);
    setActiveTab('meta_ads');
    setStatusBanner(
      plan.budget.hardCapClamped
        ? `Rancangan AI Meta Ads selesai dibuat! Pagar Budget mengunci budget harian ke ${formatIdr(plan.budget.appliedDailyBudgetIdr)}/hari.`
        : `Rancangan AI Meta Ads "${plan.campaignName}" selesai disusun lengkap dengan demografi, interest resmi Meta, & A/B creative!`,
    );
    } catch (error) { setStatusBanner(error instanceof Error ? error.message : 'Rancangan budget belum valid.'); }
  };

  const handleToggleMetaCampaignRun = async (_campaignId: string) => {
    setStatusBanner('Eksekusi iklan belum diaktifkan. Tidak ada kampanye yang dikirim ke Meta.');
  };

  const handleRunMetaAutoOptimizer = (_campaignId: string) => {
    setStatusBanner('Optimizer iklan belum diaktifkan. Metrik kampanye tidak diubah.');
  };

  const handleAdminChangeTenantPlan = (_workspaceId: string, _nextPlanId: SubscriptionPlanId) => {
    setStatusBanner('Perubahan paket menunggu integrasi Duitku dan verifikasi pembayaran server.');
  };

  const handleSaveCloudConnectionConfig = () => {
    setOpenAiInputKey('');
    setStatusBanner('Konfigurasi produksi dikelola melalui environment dan Secret Manager backend. Kunci API tidak disimpan di browser.');
  };

  const studioDrafts = drafts.filter(draft => studioFilter === 'all' || (studioFilter === 'published' ? draft.status === 'published' : studioFilter === 'attention' ? ['publish_failed', 'partially_published', 'needs_attention'].includes(draft.status) : !['published', 'publish_failed', 'partially_published', 'needs_attention'].includes(draft.status)));
  const organicWinnerDraft = drafts.find((d) => d.organicMetrics?.isOrganicWinner);
  const i18nCopy = VELOXA_I18N_COPY[locale];

  const isUserWorkspaceView = Boolean(
    authUser && !(authUser.isSuperAdmin && activeRole === 'admin'),
  );

  return (
    <div
      className={`min-h-dvh pb-28 text-neutral-900 ${
        isUserWorkspaceView ? 'bg-[#F8F9FC]' : 'bg-white'
      }`}
    >
      {authUser && isWorkspaceLoading && <div className="fixed inset-0 z-[100] grid place-items-center bg-white" role="status" aria-live="polite"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-pink-100 border-t-[#D85A88]" /><p className="font-medium text-neutral-800">Menyiapkan workspace Anda…</p></div></div>}
      {/* Top Global Header — Ditampilkan pada Landing Page, Super Admin, & Mobile (<1024px). Pada Desktop User Workspace, Header menyatu di sisi kanan Sidebar Pink */}
      <header
        className={`sticky top-0 z-30 border-b border-neutral-200/80 bg-white/95 text-neutral-900 backdrop-blur ${
          isUserWorkspaceView ? 'hidden' : ''
        }`}
      >
        {!authUser ? <VeloxaPublicHeader locale={locale} onLocale={handleSelectLocale} /> : (
        <div
          className={`flex items-center justify-between gap-2 ${
            isUserWorkspaceView
              ? 'w-full flex-wrap px-4 py-3 sm:px-6'
              : `mx-auto max-w-[1480px] px-3.5 py-3 sm:px-8 sm:py-3.5 lg:px-12 ${
                  authUser ? 'flex-wrap' : 'flex-nowrap'
                }`
          }`}
        >
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-[#bd416e] font-semibold text-white shadow-xs shrink-0">
              V
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base sm:text-xl font-semibold tracking-tight text-neutral-900 whitespace-nowrap">
                VELOXA AI
              </span>
              {authUser &&
                (authUser.isSuperAdmin && activeRole === 'admin' ? (
                  <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-medium text-[#a92e5d]">
                    Super Admin Control Center
                  </span>
                ) : (
                  <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-medium text-[#a92e5d]">
                    Workspace: {brand.businessName} ({brand.city})
                  </span>
                ))}
            </div>
          </div>

          {/* Right Navigation Actions — Global Language Selector + Dedicated Login/Register Pages */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
            <label htmlFor="veloxa-global-lang-select" className="sr-only">
              Select Language
            </label>
            <select
              id="veloxa-global-lang-select"
              data-testid="header-lang-select"
              value={locale}
              onChange={(e) => handleSelectLocale(e.target.value as VeloxaLocale)}
              className="max-w-[136px] sm:max-w-none truncate rounded-xl sm:rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-semibold text-neutral-800 shadow-2xs hover:border-pink-200 focus:border-[#EC749B] focus:outline-hidden"
            >
              {VELOXA_LOCALES.map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.flag} {loc.label} ({loc.currencyCode})
                </option>
              ))}
            </select>

            {!authUser ? (
              <>
                <Link
                  href="/login"
                  data-testid="open-auth-modal-btn"
                  className="rounded-xl sm:rounded-xl border border-neutral-200 bg-white px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium text-neutral-800 hover:border-pink-200 hover:text-[#a92e5d] whitespace-nowrap"
                >
                  {i18nCopy.headerSignIn}
                </Link>
                <Link
                  href="/register"
                  data-testid="open-onboarding-public-btn"
                  className="hidden sm:inline-flex rounded-xl bg-[#bd416e] px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#a92e5d] whitespace-nowrap"
                >
                  {i18nCopy.headerStartFree}
                </Link>
              </>
            ) : (
              <>
                {authUser.isSuperAdmin && activeRole === 'user' && (
                  <button
                    type="button"
                    data-testid="back-to-admin-btn"
                    onClick={() => setActiveRole('admin')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-pink-300 bg-pink-50/80 px-3.5 py-2 text-sm font-semibold text-[#a92e5d] hover:bg-[#bd416e] hover:text-white"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    ← Super Admin
                  </button>
                )}

                {activeRole === 'user' && (
                  <button
                    type="button"
                    data-testid="open-billing-modal-btn"
                    onClick={() => {
                      setSelectedCheckoutPlanId(activePlanId);
                      billingDialogRef.current?.showModal();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-pink-200 bg-pink-50/70 px-3 py-2 text-sm font-medium text-[#a92e5d] hover:bg-pink-100/70"
                  >
                    <CreditCard className="h-3.5 w-3.5 text-[#a92e5d]" />
                    {currentPlan.name} · {postsUsedThisMonth}/{currentPlan.monthlyPostQuota}
                  </button>
                )}

                <button
                  type="button"
                  data-testid="open-auth-modal-btn"
                  onClick={() => authDialogRef.current?.showModal()}
                  className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-700 hover:border-pink-200 hover:text-[#a92e5d]"
                >
                  <Lock className="h-3.5 w-3.5 text-[#a92e5d]" />
                  <span className="max-w-[140px] truncate sm:max-w-none">{authUser.email}</span>
                </button>

                <button
                  type="button"
                  data-testid="logout-btn"
                  onClick={handleRequestSignOutClick}
                  className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-600 hover:border-pink-200 hover:text-[#a92e5d]"
                >
                  {i18nCopy.headerLogout}
                </button>
              </>
            )}
          </div>
        </div>
        )}
      </header>

      {/* Main Content Container — Flush Full-Width untuk User Sidemenu, atau 1480px untuk Landing/Super Admin */}
      <main
        className={
          authUser && !(authUser.isSuperAdmin && activeRole === 'admin')
            ? 'w-full'
            : 'mx-auto max-w-[1480px] px-4 py-6 sm:px-8 lg:px-12'
        }
      >
        <div>
          {!authUser ? (
            /* ======================================================================
               KONDISI 1 (BELUM LOGIN): ULTRA-LUXURY GLOBAL MULTI-LANGUAGE LANDING PAGE
               ====================================================================== */
            <VeloxaPublicLanding
              locale={locale}
              onSelectLocale={handleSelectLocale}
              onOpenOnboarding={(defaultPlanId) => {
                if (defaultPlanId) {
                  setOnboardPlanId(defaultPlanId);
                }
                router.push('/register');
              }}
              onOpenAuthModal={() => router.push('/login')}
            />
          ) : authUser.isSuperAdmin && activeRole === 'admin' ? (
            /* ======================================================================
               KONDISI 2 (LOGIN SEBAGAI SUPER ADMIN sosrospg@gmail.com):
               MURNI SUPER ADMIN COMMAND CENTER
               ====================================================================== */
            <div className="space-y-6" data-testid="super-admin-dashboard">
              <div className="flex flex-col justify-between gap-4 rounded-xl border border-neutral-200/80 bg-white p-6 text-neutral-900 shadow-2xs sm:flex-row sm:items-center">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-sm font-medium text-[#a92e5d]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#a92e5d]" /> Super Admin Control Center ({authUser.email})
                  </span>
                  <h1 className="veloxa-hero-title mt-2 font-semibold tracking-tight text-neutral-900">
                    Manajemen Bisnis SaaS Veloxa AI
                  </h1>
                  <p className="mt-1 text-base text-neutral-500">
                    Pantau pendapatan langganan (Rp500rb – Rp1,5jt), margin API AI, kuota pelanggan, dan kredensial OAuth terpusat.
                  </p>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
                  <p className="text-sm font-medium uppercase tracking-wider text-neutral-500">
                    Gross Margin SaaS
                  </p>
                  <p className="text-3xl font-semibold text-[#a92e5d]">{adminSummary.averageGrossMarginPct}%</p>
                  <p className="text-sm text-neutral-500">Target sehat: &gt;75%</p>
                </div>
              </div>

              {/* Admin KPI Row */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-sm font-medium uppercase text-neutral-400">Pendapatan Bulanan (MRR)</p>
                  <p className="mt-2 text-2xl font-semibold text-neutral-900">
                    {formatIdr(adminSummary.totalMrrIdr)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-neutral-500">
                    {tenants.length} bisnis aktif berlangganan
                  </p>
                </div>
                <div className="rounded-xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-sm font-medium uppercase text-neutral-400">Modal API (OpenAI + Render)</p>
                  <p className="mt-2 text-2xl font-semibold text-neutral-900">
                    {formatIdr(adminSummary.totalApiCostIdr)}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    Untuk {adminSummary.totalPublishedPosts} konten tayang bulan ini
                  </p>
                </div>
                <div className="rounded-xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-sm font-medium uppercase text-neutral-400">Laba Bersih SaaS</p>
                  <p className="mt-2 text-2xl font-semibold text-[#a92e5d]">
                    {formatIdr(adminSummary.totalNetProfitIdr)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-neutral-500">
                    Margin kotor {adminSummary.averageGrossMarginPct}%
                  </p>
                </div>
                <div className="rounded-xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-sm font-medium uppercase text-neutral-400">Kampanye AI Meta Ads</p>
                  <p className="mt-2 text-2xl font-semibold text-neutral-900">
                    {adminSummary.totalActiveMetaCampaigns} Aktif
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    Ad spend ditarik langsung dari kartu user
                  </p>
                </div>
              </div>

              {/* Subscription Pricing Tiers Overview */}
              <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6">
                <h2 className="text-lg font-semibold text-neutral-900">
                  Katalog Paket Langganan Veloxa AI (Rp500rb – Rp1,5 Juta)
                </h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Pembayaran langganan dilakukan via Web (Midtrans/Xendit QRIS & VA) agar bebas potongan 30% App Store / Play Store.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {Object.values(SUBSCRIPTION_PLANS).map((plan) => (
                    <div
                      key={plan.id}
                      className={`rounded-xl border p-5 ${
                        plan.id === 'pro_1500k'
                          ? 'border-pink-300 bg-white ring-2 ring-pink-100'
                          : 'border-neutral-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-base font-semibold text-neutral-900">{plan.name}</span>
                        {plan.id === 'pro_1500k' && (
                          <span className="rounded-full bg-[#bd416e] px-2.5 py-0.5 text-xs font-medium text-white">
                            TERLARIS
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-2xl font-semibold text-neutral-900">
                        {formatIdr(plan.priceMonthlyIdr)}
                        <span className="text-sm font-semibold text-neutral-400">/bulan</span>
                      </p>
                      <p className="mt-1 text-sm text-neutral-500">{plan.tagline}</p>
                      <ul className="mt-3 space-y-1.5 text-sm text-neutral-600">
                        <li>• Kuota: <strong className="text-neutral-900">{plan.monthlyPostQuota} postingan/bulan</strong> (maks {plan.maxPostsPerDay}x/hari)</li>
                        <li>• Kanal: <strong className="text-neutral-900">{plan.allowedChannels.join(', ').toUpperCase()}</strong></li>
                        <li>• Kampanye Event: <strong className="text-neutral-900">{plan.includesEventCampaigns ? 'Termasuk' : 'Tidak'}</strong></li>
                        <li>• AI Agent Meta Ads: <strong className="text-neutral-900">{plan.includesMetaAdsAgent ? 'Termasuk + Auto-Optimizer' : 'Tidak'}</strong></li>
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              {/* Accessible Sticky Responsive Tenant Table (modern-web-guidance responsive-table) */}
              <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 id="tenant-table-caption" className="text-lg font-semibold text-neutral-900">
                      Daftar Pelanggan (Tenants) & Kontrol Kuota
                    </h2>
                    <p className="text-sm text-neutral-500">
                      Ubah paket pelanggan secara instan, pantau margin pemakaian API, atau klik &ldquo;Inspeksi Workspace&rdquo; untuk mengecek studio brand pelanggan.
                    </p>
                  </div>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="tenant-table-caption"
                  className="veloxa-table-region rounded-xl border border-neutral-200"
                >
                  <table className="text-left text-base">
                    <thead className="border-b border-neutral-200 bg-neutral-50 text-sm uppercase text-neutral-500">
                      <tr>
                        <th className="px-4 py-3.5">Brand / Bisnis</th>
                        <th className="px-4 py-3.5">Kategori</th>
                        <th className="px-4 py-3.5">Paket Langganan</th>
                        <th className="px-4 py-3.5">Kuota Bulan Ini</th>
                        <th className="px-4 py-3.5">Kanal & Meta Ads</th>
                        <th className="px-4 py-3.5">Biaya API vs Harga</th>
                        <th className="px-4 py-3.5">Ubah Paket</th>
                        <th className="px-4 py-3.5">Aksi Super Admin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 bg-white">
                      {tenants.map((t) => (
                        <tr key={t.workspaceId} className="hover:bg-neutral-50/70">
                          <th className="px-4 py-3.5 font-medium text-neutral-900">
                            <div>{t.businessName}</div>
                            <div className="text-sm font-normal text-neutral-500">
                              {t.ownerName} · {t.ownerEmail}
                            </div>
                          </th>
                          <td className="px-4 py-3.5 text-sm font-semibold uppercase text-neutral-600">
                            {t.category.replace('_', ' ')}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-1 text-sm font-medium text-[#a92e5d]">
                              {SUBSCRIPTION_PLANS[t.planId].name}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-sm font-medium text-neutral-900">
                            {t.postsPublishedThisMonth} / {t.monthlyPostQuota} post
                          </td>
                          <td className="px-4 py-3.5 text-sm text-neutral-600">
                            <div>{t.connectedChannels.length} Sosmed Aktif</div>
                            <div className="font-semibold text-[#a92e5d]">
                              {t.metaAdsConnected ? `✓ ${t.activeMetaCampaigns} Kampanye Meta Ads` : 'Tanpa Meta Ads'}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-sm">
                            <div className="font-medium text-neutral-900">
                              Bayar: {formatIdr(t.monthlySubscriptionRevenueIdr)}
                            </div>
                            <div className="text-neutral-500">
                              API: {formatIdr(t.estimatedMonthlyApiCostIdr)} (Margin {t.grossMarginPct}%)
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <select
                              aria-label={`Ubah paket ${t.businessName}`}
                              value={t.planId}
                              onChange={(e) =>
                                handleAdminChangeTenantPlan(
                                  t.workspaceId,
                                  e.target.value as SubscriptionPlanId,
                                )
                              }
                              className="rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-800"
                            >
                              <option value="starter_500k">Starter (Rp500rb)</option>
                              <option value="growth_1000k">Growth (Rp1jt)</option>
                              <option value="pro_1500k">Pro + Ads (Rp1,5jt)</option>
                            </select>
                          </td>
                          <td className="px-4 py-3.5">
                            <button
                              type="button"
                              data-testid={`inspect-tenant-btn-${t.workspaceId}`}
                              onClick={() => {
                                const presetMap: Record<string, 'running_event' | 'cafe_fnb' | 'clinic_beauty' | 'custom'> = {
                                  running_event: 'running_event',
                                  cafe_fnb: 'cafe_fnb',
                                  clinic_beauty: 'clinic_beauty',
                                };
                                handleSelectBrandPreset(presetMap[t.category] || 'custom');
                                setActivePlanId(t.planId);
                                setActiveRole('user');
                              }}
                              className="rounded-xl border border-pink-200 bg-pink-50/70 px-3 py-1.5 text-sm font-medium text-[#a92e5d] hover:bg-[#bd416e] hover:text-white"
                            >
                              Inspeksi Workspace →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Central API & OAuth Vault (1 App Developer for All Users) */}
              <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6">
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-[#a92e5d]" />
                  <h2 className="text-lg font-semibold text-neutral-900">
                    Brankas API & OAuth Terpusat (Dikelola Pemilik SaaS)
                  </h2>
                </div>
                <p className="mt-1 text-sm text-neutral-500">
                  Ringkasan layanan platform. Pengaturan teknis dikelola melalui backend.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-semibold uppercase text-neutral-400">OpenAI Master Engine</p>
                    <p className="mt-1 text-base font-medium text-neutral-900">
                      Konfigurasi model dikelola di backend
                    </p>
                    <p className="mt-1 text-sm font-medium text-neutral-600">
                      <span className="font-medium text-neutral-600">Pengaturan model belum tersedia di UI</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-semibold uppercase text-neutral-400">Meta Graph & Marketing API</p>
                    <p className="mt-1 text-base font-medium text-neutral-900">
                      App ID: {centralCreds.metaAppId}
                    </p>
                    <p className="mt-1 text-sm font-medium text-neutral-600">
                      <span className="font-medium text-neutral-600">Instagram & Facebook · mode pengujian</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-semibold uppercase text-neutral-400">TikTok & YouTube Shorts</p>
                    <p className="mt-1 text-base font-medium text-neutral-900">
                      Integrasi belum tersedia
                    </p>
                    <p className="mt-1 text-sm font-medium text-neutral-600">
                      <span className="font-medium text-neutral-600">Pembayaran belum tersedia</span>
                    </p>
                  </div>
                </div>
              </section>

              {/* Cloud Firebase Database & 5 OpenAI Agents Configuration Panel (Cendekia-Style Architecture) */}
              <section className="veloxa-panel p-6"><h2 className="text-lg font-semibold">Pengaturan platform</h2><p className="mt-3 text-base leading-relaxed text-neutral-500">Konfigurasi AI dan koneksi layanan dikelola di backend. Pengaturan Super Admin akan dikembangkan pada tahap berikutnya.</p></section>
            </div>
          ) : (
            /* ======================================================================
               ROLE 2: LUXURY EXECUTIVE USER WORKSPACE DASHBOARD
               (FULL-HEIGHT SOLID PINK LEFT SIDEBAR FROM TOP TO BOTTOM + RIGHT HEADER)
               ====================================================================== */
            <VeloxaWorkspaceShell
              activeTab={activeTab} brandName={brand.businessName} planName={currentPlan.name}
              email={authUser.email} displayName={authUser.displayName || brand.businessName}
              used={postsUsedThisMonth} quota={currentPlan.monthlyPostQuota} locale={locale}
              onNavigate={setActiveTab} onCreate={() => setActiveTab('studio')}
              onConnections={() => handleOpenOAuthConfigModal(connections.some(item => item.channel === 'facebook' && item.connected) ? 'facebook' : 'instagram')}
              onBilling={() => { setSelectedCheckoutPlanId(activePlanId); billingDialogRef.current?.showModal(); }}
              onAccount={() => authDialogRef.current?.showModal()} onSignOut={handleRequestSignOutClick}
              onSync={() => void handleForceCloudSync()} onLocale={handleSelectLocale}
              isSuperAdmin={authUser.isSuperAdmin} onAdmin={() => setActiveRole('admin')}
              status={statusBanner || undefined}
              presetControls={authUser.isSuperAdmin ? <select aria-label="Pilih Inspeksi Brand" value={selectedPresetKey} onChange={event => handleSelectBrandPreset(event.target.value as 'running_event' | 'cafe_fnb' | 'clinic_beauty' | 'custom')} className="mt-3 w-full rounded-lg border p-2 text-base"><option value="running_event">Nusantara Run</option><option value="cafe_fnb">Kopi Senja</option><option value="clinic_beauty">GlowDerm</option><option value="custom">Brand aktif</option></select> : undefined}
            >
              {/* ====================================================================
                 TAB 1: EXECUTIVE ANALYTICS OVERVIEW, CHARTS & 4-CHANNEL COMMAND HUB
                 ==================================================================== */}
              {activeTab === 'overview' && (
                <VeloxaWorkspaceOverview
                  connectionsVerified={connectionsVerified}
                  onEditProfile={() => setActiveTab('brand_vault')}
                  onCreateContent={(format) => { setStudioFormat(format); setActiveTab('studio'); }}
                  brand={brand}
                  currentPlan={currentPlan}
                  postsUsedThisMonth={postsUsedThisMonth}
                  connections={connections}
                  metaAccount={metaAccount}
                  autonomyConfig={autonomyConfig}
                  drafts={drafts}
                  metaAdCampaigns={metaAdCampaigns}
                  organicWinnerDraft={organicWinnerDraft}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                  onToggleChannel={handleToggleChannel}
                  onOpenOAuthConfigModal={handleOpenOAuthConfigModal}
                  onPublishDraftNow={handlePublishDraftNow}
                  onDesignMetaAdsWithAi={handleDesignMetaAdsWithAi}
                  onOpenBillingModal={() => {
                    setSelectedCheckoutPlanId(activePlanId);
                    billingDialogRef.current?.showModal();
                  }}
                />
              )}

              {/* ====================================================================
                 TAB 2: BRAND BRAIN & DUAL ASSET VAULT (REFERENSI GAYA vs FOTO ASLI)
                 ==================================================================== */}
              {activeTab === 'brand_vault' && (
                <VeloxaBrandWorkspace key={brand.workspaceId} brand={brand} assets={vaultAssets} onSave={handleSaveBrandProfile} onUpload={handleUploadBrandPhoto} onAssetState={handleAssetState} onReload={handleReloadBrandPhotos} />
              )}

              {/* ====================================================================
                 TAB 3: STUDIO KONTEN MULTI-PLATFORM (IG, FB, TIKTOK, YOUTUBE SHORTS)
                 ==================================================================== */}
              {activeTab === 'studio' && (
                <div className="space-y-6">
                  <VeloxaStudioComposer brandName={brand.businessName} format={studioFormat} topic={studioTopic} assetIds={selectedReferenceIds} referenceInstruction={referenceInstruction} assets={vaultAssets} creating={isCreatingContent} feedback={generationFeedback} onFormat={setStudioFormat} onTopic={setStudioTopic} onAssets={setSelectedReferenceIds} onInstruction={setReferenceInstruction} onManageAssets={() => setActiveTab('brand_vault')} onCreate={() => void handleGenerateStudioDraft('manual_studio')} />

                  <div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-semibold">Koleksi konten <span className="ml-1 text-base font-normal text-neutral-400">{drafts.length}</span></h2><div role="group" aria-label="Filter konten" className="flex max-w-full flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1">{([{id:'all',label:'Semua'},{id:'draft',label:'Draf'},{id:'published',label:'Terbit'},{id:'attention',label:'Perlu perhatian'}] as const).map(item => <button type="button" key={item.id} aria-pressed={studioFilter === item.id} onClick={() => setStudioFilter(item.id)} className={`rounded-md px-3 py-2 text-sm ${studioFilter === item.id ? 'bg-neutral-100 font-medium text-neutral-950' : 'text-neutral-500 hover:text-neutral-900'}`}>{item.label}</button>)}</div></div>
                  {studioDrafts.length === 0 && <div className="veloxa-panel px-6 py-12 text-center"><p className="text-lg font-medium">{drafts.length ? 'Belum ada konten pada filter ini.' : 'Draf pertama Anda dimulai dari sini.'}</p><p className="mt-2 text-base text-neutral-500">{drafts.length ? 'Pilih filter lain untuk melihat koleksi konten.' : 'Pilih format dan tulis ide pada formulir di atas.'}</p></div>}

                  {/* Generated Drafts List */}
                  <div className="space-y-4">
                    {studioDrafts.map((draft) => (
                      <article
                        key={draft.id}
                        className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-sm font-semibold text-[#a92e5d]">
                                {draft.status === 'published' ? '✓ Sudah Tayang' : draft.status === 'needs_attention' ? 'Perlu diperiksa di Meta' : draft.status === 'partially_published' ? 'Sebagian kanal berhasil' : draft.status === 'publish_failed' ? 'Publikasi gagal' : draft.status === 'publishing' ? 'Sedang mengirim' : 'Draf — tinjau sebelum terbit'}
                              </span>
                              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-sm font-medium text-neutral-700">
                                {draft.format === 'short_video'
                                  ? `Video 9:16 (${draft.videoDurationSeconds || 28} dtk)`
                                  : draft.format === 'carousel'
                                    ? `Carousel (${draft.renderedSlides?.length || draft.slides?.length || 0} slide)`
                                    : 'Post Tunggal'}
                              </span>
                              {draft.usedRealAssetIds.length > 0 && (
                                <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-sm font-medium text-neutral-700">
                                  Referensi visual: {draft.usedRealAssetIds.length} foto
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 text-base font-semibold text-neutral-900">{draft.title}</h3>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {draft.status !== 'published' && (
                              <button
                                type="button"
                                disabled={!!publishingDraftId || !draft.qualityReview.passed || ['needs_attention', 'publishing'].includes(draft.status) || (draft.format === 'short_video' ? !draft.renderedVideo : draft.format === 'carousel' ? draft.renderedSlides?.length !== 5 : !draft.renderedMedia)}
                                onClick={() => handlePublishDraftNow(draft.id)}
                                className="rounded-xl bg-[#bd416e] px-4 py-2 text-sm font-semibold text-white shadow-2xs hover:bg-[#a92e5d]"
                              >
                                <Send className="mr-1.5 inline h-3.5 w-3.5" />
                                {draft.status === 'partially_published' ? 'Tinjau kanal yang gagal' : 'Tinjau & terbitkan'}
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid={`download-poster-btn-${draft.id}`}
                              onClick={() => {
                                if (draft.format === 'short_video' && draft.renderedVideo) {
                                  window.open(draft.renderedVideo.url, '_blank', 'noopener,noreferrer');
                                  setStatusBanner('Video MP4 final dibuka. Gunakan kontrol video untuk memutar atau menyimpan.');
                                } else if (draft.renderedMedia) {
                                  window.open(draft.renderedMedia.url, '_blank', 'noopener,noreferrer');
                                  setStatusBanner('Gambar JPEG final dibuka. Gunakan menu simpan gambar pada perangkat Anda.');
                                } else {
                                  downloadDraftPosterSvg(draft, brand);
                                  setStatusBanner('Template SVG draf lama dibuka untuk diunduh. Buat ulang melalui Studio untuk menyiapkan JPEG publikasi.');
                                }
                              }}
                              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-pink-200 hover:text-[#a92e5d]"
                            >
                              <Download className="mr-1.5 inline h-3.5 w-3.5 text-[#a92e5d]" />
                              {draft.format === 'short_video' ? 'Buka Video MP4' : 'Buka gambar'}
                            </button>
                            {draft.format !== 'short_video' && (
                            <button
                              type="button"
                              data-testid={`play-voiceover-btn-${draft.id}`}
                              onClick={() => handlePlayDraftVoiceover(draft)}
                              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-pink-200 hover:text-[#a92e5d]"
                            >
                              <Volume2 className="mr-1.5 inline h-3.5 w-3.5 text-[#a92e5d]" />
                              {playingVoiceoverDraftId === draft.id
                                ? 'Hentikan pembacaan teks'
                                : 'Dengarkan caption'}
                            </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDesignMetaAdsWithAi(draft)}
                              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-pink-200 hover:text-[#a92e5d]"
                            >
                              <Megaphone className="mr-1.5 inline h-3.5 w-3.5 text-[#a92e5d]" />
                              Rancang iklan
                            </button>
                          </div>
                        </div>

                        {/* Live Rendered Visual Poster / Carousel Preview + Quality Gate */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
                          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 p-2">
                            <StudioMediaPreview draft={draft} fallbackUrl={buildRenderedVisualSvgDataUrl({ brand, draft, slideIndex: 0 })} />
                          </div>
                          <div className="space-y-3">
                            <details className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600"><summary className="cursor-pointer font-medium text-neutral-800">Pemeriksaan kualitas · {draft.qualityReview.score}/100</summary><p className="mt-3 leading-relaxed">{draft.qualityReview.summary}</p><p className="mt-2">{draft.qualityReview.issues.length} masalah · {draft.qualityReview.repairAttempts} perbaikan</p></details>

                            {/* Multi-Channel Distribution Badges */}
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-medium text-neutral-500">Tujuan publikasi:</span>
                              {draft.channelStatuses.map((cs) => (
                                <span
                                  key={cs.channel}
                                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHANNEL_META[cs.channel].badgeClass}`}
                                >
                                  {CHANNEL_META[cs.channel].shortLabel}:{' '}
                                  <span className="text-[#a92e5d]">
                                    {cs.status === 'published' ? '✓ Sudah Tayang' : cs.status === 'failed' ? 'Gagal dikirim' : cs.status === 'unknown' ? 'Perlu diperiksa' : 'Belum diterbitkan'}
                                    {cs.permalink && <a href={cs.permalink} target="_blank" rel="noopener noreferrer" className="ml-2 underline">Lihat posting ↗</a>}
                                    {cs.note && <span className="ml-2 text-red-700">{cs.note}</span>}
                                  </span>
                                </span>
                              ))}
                            </div>
                            <p className="whitespace-pre-line rounded-xl border border-neutral-100 bg-white p-3 text-sm text-neutral-600">
                              <strong className="text-neutral-900">Caption:</strong> {[draft.caption, draft.hashtags.join(' ')].filter(Boolean).join('\n\n')}
                            </p>
                          </div>
                        </div>

                        {/* Storyboard / Slides Preview — Clean White Cards */}
                        {draft.videoScenes && (
                          <details className="mt-5 border-t border-neutral-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-neutral-600">Lihat naskah & storyboard</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {draft.videoScenes.map((scene) => (
                              <div
                                key={scene.sceneNumber}
                                className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-900"
                              >
                                <div>
                                  <div className="flex items-center justify-between text-xs font-medium text-[#a92e5d]">
                                    <span>ADEGAN {scene.sceneNumber}</span>
                                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600">
                                      {scene.timeRange}
                                    </span>
                                  </div>
                                  <p className="mt-2 font-semibold text-neutral-900">{scene.textOverlay}</p>
                                  <p className="mt-2 text-xs text-neutral-600">
                                    <strong className="text-neutral-800">VO:</strong> &ldquo;{scene.voiceover}&rdquo;
                                  </p>
                                </div>
                                <p className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-500">
                                  Visual: {scene.visualDirection}
                                </p>
                              </div>
                            ))}
                          </div></details>
                        )}

                        {draft.slides && (
                          <details className="mt-5 border-t border-neutral-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-neutral-600">Lihat isi setiap slide</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {draft.slides.map((slide) => (
                              <div
                                key={slide.slideNumber}
                                className="rounded-xl border border-neutral-200 bg-white p-4 text-sm"
                              >
                                <div className="flex items-center justify-between font-medium text-[#a92e5d]">
                                  <span>SLIDE 0{slide.slideNumber}</span>
                                  <span className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-xs text-neutral-600">
                                    {slide.badgeText}
                                  </span>
                                </div>
                                <p className="mt-2 font-semibold text-neutral-900">{slide.headline}</p>
                                <p className="mt-1 text-neutral-600">{slide.body}</p>
                                <p className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-400">
                                  {!draft.renderedMedia && slide.visualDirection}
                                </p>
                              </div>
                            ))}
                          </div></details>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {/* ====================================================================
                 TAB 4: AGENT KONTEN OTONOM & KAMPANYE EVENT (USER BEBAS ATUR FREKUENSI)
                 ==================================================================== */}
              {activeTab === 'autonomy' && (
                <div className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                    {/* User-Controlled Autonomous Schedule */}
                    <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-sm font-medium text-[#a92e5d]">
                          Rencana konten
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setStatusBanner('Penjadwalan otomatis belum diaktifkan. Gunakan Studio untuk meninjau dan menerbitkan post tunggal dahulu.')
                          }
                          className={`rounded-full px-3.5 py-1 text-sm font-semibold ${
                            autonomyConfig.enabled
                              ? 'bg-[#bd416e] text-white shadow-2xs'
                              : 'border border-neutral-200 bg-neutral-100 text-neutral-600'
                          }`}
                        >
                          {autonomyConfig.enabled ? '● Otonom Aktif' : '○ Dijeda'}
                        </button>
                      </div>

                      <h2 className="mt-2 text-lg font-semibold text-neutral-900">
                        Atur jadwal konten
                      </h2>
                      <p className="text-sm text-neutral-500">
                        Penjadwalan otomatis belum tersedia. Anda tetap dapat membuat dan menerbitkan konten melalui Studio.
                      </p>

                      <div className="mt-4 space-y-4 text-sm">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label htmlFor="veloxa-field-9" className="font-medium text-neutral-700">
                              Frekuensi Posting per Hari
                            </label>
                            <select id="veloxa-field-9"
                              aria-label="Frekuensi Posting per Hari"
                              value={autonomyConfig.postsPerDay}
                              onChange={(e) => {
                                const count = Number(e.target.value) as 1 | 2 | 3 | 4;
                                const presets: Record<number, string[]> = {
                                  1: ['08:00'],
                                  2: ['07:00', '19:00'],
                                  3: ['07:00', '12:30', '19:30'],
                                  4: ['07:00', '11:30', '16:00', '20:00'],
                                };
                                setAutonomyConfig({
                                  ...autonomyConfig,
                                  postsPerDay: count,
                                  scheduleTimesWib: presets[count],
                                });
                              }}
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-medium text-neutral-900"
                            >
                              <option value={1}>1x Sehari (30 konten/bulan)</option>
                              <option value={2}>2x Sehari · Pagi & Malam (60 konten/bulan)</option>
                              <option value={3}>3x Sehari · Pagi, Siang, Malam (90 konten/bulan)</option>
                              <option value={4}>4x Sehari · Agresif Kampanye</option>
                            </select>
                          </div>

                          <div>
                            <label htmlFor="veloxa-field-10" className="font-medium text-neutral-700">Mode Kepercayaan Otonom</label>
                            <select id="veloxa-field-10"
                              value={autonomyConfig.executionMode}
                              onChange={(e) =>
                                setAutonomyConfig({
                                  ...autonomyConfig,
                                  executionMode: e.target.value as AutonomyConfig['executionMode'],
                                })
                              }
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-medium text-neutral-900"
                            >
                              <option value="full_autonomous">
                                Publikasi otomatis · belum tersedia
                              </option>
                              <option value="copilot_review">
                                Tinjau sebelum terbit
                              </option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <p id="veloxa-field-11" className="font-medium text-neutral-700">
                            Jam Tayang Otomatis (WIB): {autonomyConfig.scheduleTimesWib.join(' · ')} WIB
                          </p>
                          <div role="group" aria-labelledby="veloxa-field-11" className="mt-2 flex flex-wrap gap-2">
                            {autonomyConfig.scheduleTimesWib.map((slot, idx) => (
                              <input aria-label={`Jam tayang ${idx + 1} (WIB)`}
                                key={idx}
                                type="time"
                                value={slot}
                                onChange={(e) => {
                                  const next = [...autonomyConfig.scheduleTimesWib];
                                  next[idx] = e.target.value;
                                  setAutonomyConfig({ ...autonomyConfig, scheduleTimesWib: next });
                                }}
                                className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-900"
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4">
                          <p className="font-medium text-neutral-800">
                            Komposisi Pilar Konten Otomatis:
                          </p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
                              <span className="text-lg font-semibold text-[#a92e5d]">
                                {autonomyConfig.contentMixPct.educationTips}%
                              </span>
                              <p className="text-xs text-neutral-500">Edukasi & Tips</p>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
                              <span className="text-lg font-semibold text-neutral-900">
                                {autonomyConfig.contentMixPct.communityStory}%
                              </span>
                              <p className="text-xs text-neutral-500">Cerita & Testimoni</p>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
                              <span className="text-lg font-semibold text-neutral-900">
                                {autonomyConfig.contentMixPct.productEventPromo}%
                              </span>
                              <p className="text-xs text-neutral-500">Promo Produk/Event</p>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateStudioDraft(
                              'autonomous_agent',
                              `Hari ini, ${autonomyConfig.scheduleTimesWib[0] || '07:00'} WIB`,
                            )
                          }
                          className="w-full rounded-xl bg-[#bd416e] py-3 font-semibold text-white shadow-2xs hover:bg-[#a92e5d]"
                        >
                          <Bot className="mr-1.5 inline h-4 w-4 text-white" />
                          Coba rencana jadwal
                        </button>
                      </div>
                    </section>

                    {/* Event Campaign Countdown Manager */}
                    <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6">
                      <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-sm font-medium text-[#a92e5d]">
                        Kampanye event
                      </span>
                      <h2 className="mt-2 text-lg font-semibold text-neutral-900">
                        Rencanakan konten event
                      </h2>
                      <p className="text-sm text-neutral-500">
                        Sangat cocok untuk Event Lari, Launching Menu Baru Cafe, atau Promo Tanggal Kembar.
                      </p>

                      <div className="mt-4 space-y-3 text-sm">
                        {eventCampaigns.map((camp) => {
                          const phase = computeEventCampaignPhase(camp.eventDateIso);
                          return (
                            <div
                              key={camp.id}
                              className="rounded-xl border border-neutral-200 bg-white p-4"
                            >
                              <div className="flex items-center justify-between">
                                <span className="rounded-full bg-[#bd416e] px-2.5 py-0.5 text-xs font-medium text-white">
                                  {phase.phaseLabel}
                                </span>
                                <span className="font-medium text-neutral-600">
                                  Target: {camp.currentConversions}/{camp.targetRegistrationsOrSales} pendaftar/pembeli
                                </span>
                              </div>
                              <h3 className="mt-2 text-base font-semibold text-neutral-900">{camp.name}</h3>
                              <p className="mt-0.5 text-neutral-600">{camp.ticketOrPromoHighlight}</p>
                              <p className="mt-1.5 text-xs font-semibold text-[#a92e5d]">
                                Arahan AI Hari Ini: {phase.contentAngleDirective}
                              </p>
                            </div>
                          );
                        })}

                        <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-3.5">
                          <p className="font-medium text-neutral-900">+ Tambah Kampanye Event Baru</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <input
                              type="text"
                              placeholder="Nama Event (misal: Jakarta Night Run 10K)"
                              value={newCampaignName}
                              onChange={(e) => setNewCampaignName(e.target.value)}
                              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
                            />
                            <input
                              type="date"
                              value={newCampaignDate}
                              onChange={(e) => setNewCampaignDate(e.target.value)}
                              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
                            />
                          </div>
                          <input
                            type="text"
                            placeholder="Info Tiket / Promo Utama (misal: Early Bird Rp199rb + Medali)"
                            value={newCampaignHighlight}
                            onChange={(e) => setNewCampaignHighlight(e.target.value)}
                            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
                          />
                          <button
                            type="button"
                            onClick={handleCreateEventCampaign}
                            className="mt-2 w-full rounded-xl bg-[#bd416e] py-2.5 font-medium text-white shadow-2xs hover:bg-[#a92e5d]"
                          >
                            Aktifkan Kampanye Event ke Agent Otonom
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {/* ====================================================================
                 TAB 5: AI AGENT MARKETING · META ADS ARCHITECT & AUTO-OPTIMIZER
                 ==================================================================== */}
              {activeTab === 'meta_ads' && (
                <div className="space-y-6" data-testid="meta-ads-agent-panel">
                  <p role="note" className="rounded-lg border border-neutral-200 bg-white px-5 py-4 text-base leading-relaxed text-neutral-600">Fitur ini membantu menyusun rencana dan materi iklan. Penayangan serta optimasi iklan otomatis belum diaktifkan.</p>
                  {/* AI Meta Ads Campaign Designer */}
                  <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-sm font-medium text-[#a92e5d]">
                          Perencanaan iklan
                        </span>
                        <h2 className="mt-2 text-lg font-semibold text-neutral-900">
                          Susun rencana iklan Anda
                        </h2>
                        <p className="text-sm text-neutral-500">
                          Tentukan tujuan, audiens, materi, dan anggaran. Rencana ini belum menjalankan iklan.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label htmlFor="veloxa-field-12" className="font-medium text-neutral-700">Tujuan Kampanye (Objective)</label>
                        <select id="veloxa-field-12"
                          value={adObjective}
                          onChange={(e) => setAdObjective(e.target.value as MetaAdObjective)}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-medium text-neutral-900"
                        >
                          <option value="WHATSAPP_MESSAGES">
                            Pesan Chat WhatsApp (CTWA)
                          </option>
                          <option value="WEBSITE_CONVERSIONS">
                            Pendaftaran Event / Pembelian Web
                          </option>
                          <option value="INSTAGRAM_PROFILE_VISITS">
                            Kunjungan & Followers Instagram
                          </option>
                          <option value="LEAD_GENERATION">
                            Formulir Prospek (Meta Leads)
                          </option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="veloxa-field-13" className="font-medium text-neutral-700">Produk / Event yang Diiklankan</label>
                        <input id="veloxa-field-13"
                          type="text"
                          value={adPromoTitle}
                          onChange={(e) => setAdPromoTitle(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-semibold text-neutral-900"
                        />
                      </div>

                      <div>
                        <p id="veloxa-field-14" className="font-medium text-neutral-700">
                          Kota Target & Radius (km)
                        </p>
                        <div role="group" aria-labelledby="veloxa-field-14" className="mt-1 flex gap-2">
                          <input aria-label="Kota target"
                            type="text"
                            value={adCity}
                            onChange={(e) => setAdCity(e.target.value)}
                            className="w-2/3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-semibold text-neutral-900"
                          />
                          <input aria-label="Radius area (km)"
                            type="number"
                            value={adRadiusKm}
                            min={3}
                            max={80}
                            onChange={(e) => setAdRadiusKm(Number(e.target.value))}
                            className="w-1/3 rounded-xl border border-neutral-200 bg-white px-2.5 py-2.5 font-medium text-neutral-900"
                          />
                        </div>
                      </div>

                      <div>
                        <p id="veloxa-field-15" className="font-medium text-neutral-700">
                          Rentang Usia Demografi ({adAgeMin} – {adAgeMax} thn)
                        </p>
                        <div role="group" aria-labelledby="veloxa-field-15" className="mt-1 flex gap-2">
                          <input aria-label="Usia minimum"
                            type="number"
                            value={adAgeMin}
                            min={18}
                            max={55}
                            onChange={(e) => setAdAgeMin(Number(e.target.value))}
                            className="w-1/2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-medium text-neutral-900"
                          />
                          <input aria-label="Usia maksimum"
                            type="number"
                            value={adAgeMax}
                            min={20}
                            max={65}
                            onChange={(e) => setAdAgeMax(Number(e.target.value))}
                            className="w-1/2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-medium text-neutral-900"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="veloxa-field-16" className="font-medium text-neutral-700">
                          Kata Kunci Interest Tambahan
                        </label>
                        <input id="veloxa-field-16"
                          type="text"
                          value={adCustomInterest}
                          onChange={(e) => setAdCustomInterest(e.target.value)}
                          placeholder="Misal: Strava, Kopi Gayo, Skincare"
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900"
                        />
                      </div>

                      <div>
                        <label htmlFor="veloxa-field-17" className="font-medium text-neutral-700">Budget Harian (IDR)</label>
                        <input id="veloxa-field-17"
                          type="number"
                          step={25000}
                          value={adDailyBudgetIdr}
                          onChange={(e) => setAdDailyBudgetIdr(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-semibold text-neutral-900"
                        />
                      </div>

                      <div>
                        <label htmlFor="veloxa-field-18" className="font-medium text-neutral-700">Durasi Tayang (Hari)</label>
                        <input id="veloxa-field-18"
                          type="number"
                          min={1}
                          max={90}
                          value={adDurationDays}
                          onChange={(e) => setAdDurationDays(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-medium text-neutral-900"
                        />
                      </div>

                      <div>
                        <label htmlFor="veloxa-field-19" className="font-medium text-[#a92e5d]">
                          Pagar Pengaman Budget Harian
                        </label>
                        <input id="veloxa-field-19"
                          type="number"
                          step={25000}
                          value={metaAccount.dailyHardCapIdr}
                          onChange={(e) =>
                            setMetaAccount({
                              ...metaAccount,
                              dailyHardCapIdr: Number(e.target.value),
                            })
                          }
                          className="mt-1 w-full rounded-xl border border-pink-200 bg-white px-3 py-2.5 font-semibold text-neutral-900"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2">
                      <p className="text-sm text-neutral-500">
                        Estimasi total anggaran: <strong className="text-neutral-900">{formatIdr(Math.min(adDailyBudgetIdr, metaAccount.dailyHardCapIdr) * adDurationDays)}</strong> ({adDurationDays} hari) · Belum ada anggaran yang dibelanjakan.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleDesignMetaAdsWithAi()}
                        className="rounded-xl bg-[#bd416e] px-6 py-3 text-sm font-semibold text-white shadow-2xs hover:bg-[#a92e5d]"
                      >
                        <Sparkles className="mr-1.5 inline h-4 w-4" />
                        Buat rencana iklan
                      </button>
                    </div>
                  </section>

                  {/* Active & Draft AI Meta Ads Campaigns */}
                  <div className="space-y-5">
                    {metaAdCampaigns.map((camp) => (
                      <article
                        key={camp.id}
                        className="veloxa-luxury-card veloxa-dashboard-panel rounded-xl border border-neutral-200/90 bg-white p-6"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full border px-3 py-0.5 text-sm font-semibold ${
                                  camp.status === 'active_running'
                                    ? 'border-pink-200 bg-pink-50/70 text-[#a92e5d]'
                                    : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                                }`}
                              >
                                {camp.status === 'active_running'
                                  ? 'Rencana tersimpan'
                                  : 'Rencana tersimpan · belum ditayangkan'}
                              </span>
                              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-sm font-medium text-neutral-600">
                                Objective: {camp.objective.replace('_', ' ')}
                              </span>
                              {camp.budget.hardCapClamped && (
                                <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-sm font-medium text-[#a92e5d]">
                                  ✓ Dijaga Pagar Budget ({formatIdr(camp.budget.appliedDailyBudgetIdr)}/hari)
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 text-lg font-semibold text-neutral-900">
                              {camp.campaignName}
                            </h3>
                            <p className="text-sm text-neutral-500">
                              Tujuan Klik: <code>{camp.destinationUrlOrWa}</code> · Total Anggaran {camp.budget.durationDays} Hari:{' '}
                              <strong className="text-neutral-900">{formatIdr(camp.budget.totalBudgetIdr)}</strong>
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled
                              onClick={() => handleToggleMetaCampaignRun(camp.id)}
                              className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                                camp.status === 'active_running'
                                  ? 'border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#a92e5d]'
                                  : 'bg-[#bd416e] text-white shadow-2xs hover:bg-[#a92e5d]'
                              }`}
                            >
                              Penayangan belum tersedia
                            </button>
                            <button
                              type="button"
                              disabled
                              onClick={() => handleRunMetaAutoOptimizer(camp.id)}
                              className="rounded-xl bg-[#bd416e] px-4 py-2.5 text-sm font-semibold text-white shadow-2xs hover:bg-[#a92e5d]"
                            >
                              <Zap className="mr-1.5 inline h-3.5 w-3.5 text-white" />
                              Optimasi belum tersedia
                            </button>
                          </div>
                        </div>

                        {/* 3 Pillars of Meta Ads: Demographics, Validated Interests, Budget & Outcome */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
                          {/* Column 1: Demografi & Geo */}
                          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
                            <p className="font-semibold uppercase tracking-wider text-neutral-400">
                              1. Sisi Demografi & Lokasi
                            </p>
                            <ul className="mt-2.5 space-y-1.5 text-neutral-600">
                              <li>
                                • <strong className="text-neutral-900">Usia Target:</strong> {camp.demographics.ageMin} – {camp.demographics.ageMax} tahun
                              </li>
                              <li>
                                • <strong className="text-neutral-900">Lokasi & Radius:</strong>{' '}
                                {camp.demographics.locations
                                  .map((l) => `${l.cityOrPinName} (+${l.radiusKm} km)`)
                                  .join(', ')}
                              </li>
                              <li>
                                • <strong className="text-neutral-900">Bahasa:</strong> {camp.demographics.languages.join(', ')}
                              </li>
                              <li>
                                • <strong className="text-neutral-900">Advantage+ Audience:</strong> Aktif dengan panduan sinyal AI
                              </li>
                            </ul>
                          </div>

                          {/* Column 2: Validated Meta Interests */}
                          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
                            <p className="font-semibold uppercase tracking-wider text-neutral-400">
                              2. Sisi Interest Resmi Meta API
                            </p>
                            <div className="mt-2.5 space-y-2">
                              {camp.validatedInterests.slice(0, 3).map((interest) => (
                                <div
                                  key={interest.id}
                                  className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-2.5"
                                >
                                  <div className="flex items-center justify-between font-medium text-neutral-900">
                                    <span>{interest.name}</span>
                                    <span className="text-xs text-[#a92e5d]">
                                      ID #{interest.id.slice(-5)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-xs text-neutral-500">
                                    Ukuran audiens: {(interest.audienceSizeLower / 1_000_000).toFixed(1)}M –{' '}
                                    {(interest.audienceSizeUpper / 1_000_000).toFixed(1)}M orang
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Column 3: Sisi Budget & Estimasi Hasil */}
                          <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm">
                            <p className="font-semibold uppercase tracking-wider text-neutral-400">
                              3. Sisi Budget & Proyeksi Harian
                            </p>
                            <div className="mt-2.5 space-y-2 text-neutral-600">
                              <div className="flex justify-between">
                                <span>Budget Harian Aktif:</span>
                                <strong className="text-neutral-900">
                                  {formatIdr(camp.budget.appliedDailyBudgetIdr)}/hari
                                </strong>
                              </div>
                              <div className="flex justify-between">
                                <span>Estimasi Jangkauan (Reach):</span>
                                <strong className="text-neutral-900">
                                  {camp.estimatedDailyOutcome.reachMin.toLocaleString('id-ID')} –{' '}
                                  {camp.estimatedDailyOutcome.reachMax.toLocaleString('id-ID')} org/hari
                                </strong>
                              </div>
                              <div className="flex justify-between">
                                <span>Estimasi Klik CTA:</span>
                                <strong className="text-neutral-900">
                                  {camp.estimatedDailyOutcome.estimatedClicksMin} –{' '}
                                  {camp.estimatedDailyOutcome.estimatedClicksMax} klik/hari
                                </strong>
                              </div>
                              <div className="flex justify-between">
                                <span>Target Biaya per Hasil (CPR):</span>
                                <strong className="text-[#a92e5d]">
                                  ~{formatIdr(camp.estimatedDailyOutcome.estimatedCostPerResultIdr)} / konversi
                                </strong>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* A/B Creative Performance & Auto-Optimizer Split */}
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {camp.creatives.map((cr) => (
                            <div
                              key={cr.id}
                              className={`rounded-xl border p-4 text-sm ${
                                cr.status === 'winner_scaled'
                                  ? 'border-pink-300 bg-white ring-1 ring-pink-100'
                                  : cr.status === 'paused_by_ai_loser'
                                    ? 'border-neutral-200 bg-neutral-50 opacity-75'
                                    : 'border-neutral-200 bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-neutral-900">{cr.variantLabel}</span>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                    cr.status === 'winner_scaled'
                                      ? 'bg-[#bd416e] text-white'
                                      : cr.status === 'paused_by_ai_loser'
                                        ? 'border border-neutral-200 bg-white text-neutral-500'
                                        : 'border border-pink-200 bg-pink-50/70 text-[#a92e5d]'
                                  }`}
                                >
                                  {cr.status === 'winner_scaled'
                                    ? `★ PEMENANG · Alokasi Budget ${cr.budgetSharePct}%`
                                    : cr.status === 'paused_by_ai_loser'
                                      ? '✕ DIMATIKAN AI (Biaya Mahal)'
                                      : `Alokasi Budget ${cr.budgetSharePct}%`}
                                </span>
                              </div>
                              <p className="mt-1.5 font-medium text-neutral-900">{cr.headline}</p>
                              <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500">
                                <span>CTR: <strong className="text-neutral-900">{cr.metrics.ctrPct}%</strong></span>
                                <span>Konversi: <strong className="text-neutral-900">{cr.metrics.conversions} hasil</strong></span>
                                <span>
                                  Biaya per Hasil:{' '}
                                  <strong className="text-neutral-900">
                                    {formatIdr(cr.metrics.costPerResultIdr)}
                                  </strong>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* AI Media Buyer Optimization Logs */}
                        {camp.optimizationLogs.length > 0 && (
                          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 text-sm">
                            <p className="font-semibold text-neutral-900">
                              Riwayat Tindakan Otonom AI Media Buyer:
                            </p>
                            <ul className="mt-2 space-y-1.5 text-neutral-600">
                              {camp.optimizationLogs.map((log) => (
                                <li key={log.id} className="flex items-start gap-2">
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#a92e5d]" />
                                  <span>
                                    <strong className="text-neutral-900">[{log.timestampWib}]</strong> {log.summary} (Efisiensi anggaran:{' '}
                                    <strong className="text-[#a92e5d]">{formatIdr(log.savedOrReallocatedIdr)}/hari</strong>)
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </VeloxaWorkspaceShell>
          )}

          {authUser && !isUserWorkspaceView && (
            <footer
              data-testid="veloxa-workspace-footer"
              className={`mt-10 rounded-xl border border-neutral-200/80 bg-white px-6 py-4 text-sm text-neutral-500 shadow-2xs ${
                !(authUser.isSuperAdmin && activeRole === 'admin')
                  ? 'mx-4 sm:mx-7 lg:ml-[312px] lg:mr-9'
                  : ''
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#bd416e] text-xs font-semibold text-white">
                    V
                  </span>
                  <span className="font-medium text-neutral-800">
                    © 2026 Veloxa AI
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                  <span className="text-neutral-500">Workspace Veloxa</span>
                  <Link href="/privacy">Privasi</Link>
                </div>
              </div>
            </footer>
          )}
        </div>

        {/* Native Mobile Bottom Bar — Otomatis Tampil di Layar HP Asli (<768px) */}
        {!authUser ? (
          <nav
            aria-label="Mobile Quick Action Bar"
            data-testid="mobile-public-bottom-bar"
            className="veloxa-native-bottom-nav fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-neutral-200/90 bg-white/95 px-4 pt-2.5 shadow-lg backdrop-blur md:hidden"
          >
            <Link
              href="/login"
              className="flex-1 rounded-xl border border-neutral-200 bg-white py-2.5 text-center text-sm font-semibold text-neutral-800"
            >
              {i18nCopy.headerSignIn}
            </Link>
            <Link
              href="/register"
              className="flex-[1.4] rounded-xl bg-[#bd416e] py-2.5 text-center text-sm font-semibold text-white shadow-xs"
            >
              {i18nCopy.headerStartFree} →
            </Link>
          </nav>
        ) : (
          activeRole === 'user' && (
            <nav
              aria-label="Bottom Navigation Android dan iOS"
              data-testid="mobile-workspace-bottom-nav"
              className="veloxa-native-bottom-nav fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 gap-1 border-t border-neutral-200/90 bg-white/95 px-2.5 pt-2 shadow-lg backdrop-blur lg:hidden"
            >
              {(
                [
                  { id: 'overview', label: i18nCopy.mobileTabs.overview, icon: LayoutDashboard },
                  { id: 'brand_vault', label: 'Profil', icon: Camera },
                  { id: 'studio', label: i18nCopy.mobileTabs.studio, icon: Wand2 },
                  { id: 'autonomy', label: 'Jadwal', icon: Bot },
                  { id: 'meta_ads', label: i18nCopy.mobileTabs.meta_ads, icon: Megaphone },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    data-testid={`mobile-nav-tab-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-xs font-semibold transition ${
                      isActive
                        ? 'bg-pink-50/90 text-[#a92e5d] ring-1 ring-pink-200'
                        : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          )
        )}
      </main>

      {/* ========================================================================
         STAGE 1 MODAL: NEW BUSINESS ONBOARDING WIZARD (<dialog> modern-web-guidance)
         ======================================================================== */}
      <dialog
        ref={onboardingDialogRef}
        aria-labelledby="onboarding-dialog-title"
        data-testid="onboarding-dialog"
        className="w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-semibold text-[#a92e5d]">
              Tahap 1 · Onboarding Workspace Pelanggan Baru
            </span>
            <h2 id="onboarding-dialog-title" className="mt-1 text-lg font-semibold text-neutral-900">
              Daftarkan Brand / Bisnis Baru ke Veloxa AI
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onboardingDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 px-2.5 py-1 text-sm font-medium text-neutral-600 hover:text-neutral-900"
          >
            Tutup
          </button>
        </div>

        <form onSubmit={handleCompleteNewBusinessOnboarding} className="mt-4 space-y-3 text-sm">
          <div>
            <label htmlFor="onboard-biz-name" className="font-medium text-neutral-700">
              Nama Bisnis / Brand / Event
            </label>
            <input
              id="onboard-biz-name"
              data-testid="onboard-biz-name-input"
              type="text"
              required
              placeholder="Contoh: Kopi Roastery Braga / Surabaya Marathon"
              value={onboardBusinessName}
              onChange={(e) => setOnboardBusinessName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="onboard-category" className="font-medium text-neutral-700">
                Kategori Industri
              </label>
              <select
                id="onboard-category"
                value={onboardCategory}
                onChange={(e) => setOnboardCategory(e.target.value as BusinessCategory)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-medium text-neutral-900"
              >
                <option value="cafe_fnb">Cafe, Resto & F&B</option>
                <option value="running_event">Event Lari / Konser / EO</option>
                <option value="clinic_beauty">Klinik Kecantikan & Kesehatan</option>
                <option value="fashion_retail">Fashion & Retail Lokal</option>
                <option value="custom">Bisnis Kustom Lainnya</option>
              </select>
            </div>
            <div>
              <label htmlFor="onboard-city" className="font-medium text-neutral-700">
                Kota Target Utama
              </label>
              <input
                id="onboard-city"
                data-testid="onboard-city-input"
                type="text"
                required
                value={onboardCity}
                onChange={(e) => setOnboardCity(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
              />
            </div>
          </div>

          <div>
            <label htmlFor="onboard-offering" className="font-medium text-neutral-700">
              Produk / Menu / Tiket Event Unggulan
            </label>
            <input
              id="onboard-offering"
              data-testid="onboard-offering-input"
              type="text"
              placeholder="Contoh: Es Kopi Susu Gula Aren Rp22.000"
              value={onboardOfferingTitle}
              onChange={(e) => setOnboardOfferingTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="onboard-email" className="font-medium text-neutral-700">
                Email Pemilik (Tenant)
              </label>
              <input
                id="onboard-email"
                type="email"
                value={onboardOwnerEmail}
                onChange={(e) => setOnboardOwnerEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
              />
            </div>
            <div>
              <label htmlFor="onboard-plan" className="font-medium text-neutral-700">
                Paket Langganan Awal
              </label>
              <select
                id="onboard-plan"
                value={onboardPlanId}
                onChange={(e) => setOnboardPlanId(e.target.value as SubscriptionPlanId)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-medium text-neutral-900"
              >
                <option value="starter_500k">Starter (Rp500rb/bln)</option>
                <option value="growth_1000k">Growth (Rp1jt/bln)</option>
                <option value="pro_1500k">Pro + Meta Ads (Rp1,5jt/bln)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => onboardingDialogRef.current?.close()}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-medium text-neutral-700"
            >
              Batal
            </button>
            <button
              type="submit"
              data-testid="submit-onboarding-btn"
              className="rounded-xl bg-[#bd416e] px-5 py-2.5 font-semibold text-white shadow-2xs hover:bg-[#a92e5d]"
            >
              Buat Workspace & Aktifkan Brand Brain
            </button>
          </div>
        </form>
      </dialog>

      {/* ========================================================================
         STAGE 3 MODAL: WIZARD KONEKSI 4 SOSIAL MEDIA & OAUTH 2.0 RESMI (<dialog>)
         ======================================================================== */}
      <dialog
        ref={oauthDialogRef}
        aria-labelledby="oauth-dialog-title"
        data-testid="oauth-config-dialog"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            oauthDialogRef.current?.close();
          }
        }}
        className="m-auto w-full max-w-xl rounded-xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 pb-3.5">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/80 px-2.5 py-0.5 text-xs font-semibold text-[#a92e5d]">
              Akun sosial
            </span>
            <h2 id="oauth-dialog-title" className="mt-1.5 text-lg font-semibold text-neutral-900">
              Hubungkan akun sosial ke {brand.businessName}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => oauthDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-sm font-medium text-neutral-600 hover:border-pink-200 hover:text-[#a92e5d]"
          >
            Tutup ✕
          </button>
        </div>

        <p className="mt-4 text-base text-neutral-600">Pilih cara menghubungkan akun bisnis Anda.</p>

        {authUser && <VeloxaMetaConnections key={brand.workspaceId} workspaceId={brand.workspaceId} initialChannel={editingChannel} reviewAccounts={reviewOAuthAccounts} onConnections={verified => {
          setConnectionsVerified(true);
          setConnections(INITIAL_CHANNEL_CONNECTIONS.map(connection => verified.find(item => item.channel === connection.channel) || { ...connection, connected: false, handle: '', accountName: 'Belum Terhubung', followerCount: 0, tokenExpiresAt: null, oauthMode: 'disconnected', lastPublishedAt: null }));
        }} />}
      </dialog>

      {/* ========================================================================
         STAGE 4 MODAL: QRIS & VIRTUAL ACCOUNT SUBSCRIPTION CHECKOUT (<dialog>)
         ======================================================================== */}
      <dialog
        ref={billingDialogRef}
        aria-labelledby="billing-dialog-title"
        data-testid="billing-checkout-dialog"
        className="w-full max-w-xl rounded-xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-semibold text-[#a92e5d]">
              Paket & kuota
            </span>
            <h2 id="billing-dialog-title" className="mt-1 text-lg font-semibold text-neutral-900">
              Paket workspace
            </h2>
          </div>
          <button
            type="button"
            onClick={() => billingDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 px-2.5 py-1 text-sm font-medium text-neutral-600"
          >
            Tutup
          </button>
        </div>

        <div className="mt-5 space-y-5"><p className="text-base leading-relaxed text-neutral-500">Bandingkan kuota paket untuk kebutuhan bisnis Anda. Aktivasi paket berbayar dan pembayaran belum tersedia.</p><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{Object.values(SUBSCRIPTION_PLANS).map(plan => <button type="button" key={plan.id} data-testid={`select-plan-btn-${plan.id}`} aria-pressed={selectedCheckoutPlanId === plan.id} onClick={() => setSelectedCheckoutPlanId(plan.id)} className={`rounded-lg border p-4 text-left ${selectedCheckoutPlanId === plan.id ? 'border-[#bd416e] bg-[#faf2f5]' : 'border-neutral-200 bg-white'}`}><p className="text-base font-medium">{plan.name}</p><p className="mt-2 text-lg font-semibold">{formatIdr(plan.priceMonthlyIdr)}<span className="text-sm font-normal text-neutral-500">{plan.id === 'free_trial' ? ' / uji coba' : ' / bulan'}</span></p><p className="mt-2 text-sm text-neutral-500">{plan.monthlyPostQuota} publikasi</p></button>)}</div><div className="flex flex-wrap justify-end gap-3 border-t border-neutral-100 pt-4"><button type="button" onClick={() => billingDialogRef.current?.close()} className="veloxa-button-secondary">Tutup</button><button type="button" disabled data-testid="confirm-qris-payment-btn" className="veloxa-button-primary">Pembayaran belum tersedia</button></div></div>
      </dialog>

      {/* ========================================================================
         STAGE 5A MODAL: FIREBASE AUTHENTICATION (GOOGLE & EMAIL/PASSWORD LOGIN)
         ======================================================================== */}
      <dialog
        ref={authDialogRef}
        aria-labelledby="auth-dialog-title"
        data-testid="firebase-auth-dialog"
        className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-semibold text-[#a92e5d]">
              Profil akun
            </span>
            <h2 id="auth-dialog-title" className="mt-1 text-lg font-semibold text-neutral-900">
              {authUser ? 'Akun Anda' : 'Masuk ke Veloxa'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => authDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 px-2.5 py-1 text-sm font-medium text-neutral-600"
          >
            Tutup
          </button>
        </div>

        <div className="mt-5 space-y-5">{authUser ? <><div className="space-y-1"><p className="text-lg font-semibold">{authUser.displayName || brand.businessName}</p><p className="break-words text-base text-neutral-500">{authUser.email}</p></div><dl className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4"><div><dt className="text-sm text-neutral-500">Workspace</dt><dd className="mt-1 break-words text-base font-medium">{brand.businessName}</dd></div><div><dt className="text-sm text-neutral-500">Paket saat ini</dt><dd className="mt-1 text-base font-medium">{currentPlan.name}</dd></div></dl><div className="flex flex-wrap gap-3"><button type="button" onClick={() => { authDialogRef.current?.close(); setActiveTab('brand_vault'); }} className="veloxa-button-secondary">Edit profil bisnis</button><button type="button" onClick={() => { setSelectedCheckoutPlanId(activePlanId); authDialogRef.current?.close(); billingDialogRef.current?.showModal(); }} className="veloxa-button-secondary">Lihat paket</button><button type="button" onClick={() => { authDialogRef.current?.close(); handleRequestSignOutClick(); }} className="veloxa-button-secondary">Keluar akun</button></div></> : <><p className="text-base text-neutral-500">Masuk untuk melanjutkan ke workspace Anda.</p><button type="button" data-testid="google-signin-btn" onClick={() => void handleGoogleSignInClick()} className="veloxa-button-secondary w-full">Lanjutkan dengan Google</button><form onSubmit={event => void handleEmailSignInSubmit(event)} className="space-y-4"><label className="block text-sm font-medium" htmlFor="auth-email-input">Email<input id="auth-email-input" data-testid="auth-email-input" type="email" required value={authEmailInput} onChange={event => setAuthEmailInput(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral-200 p-3 text-base"/></label><label className="block text-sm font-medium" htmlFor="auth-password-input">Password<input id="auth-password-input" data-testid="auth-password-input" type="password" required minLength={6} value={authPasswordInput} onChange={event => setAuthPasswordInput(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral-200 p-3 text-base"/></label><button type="submit" data-testid="email-signin-submit-btn" className="veloxa-button-primary w-full">Masuk</button></form></>}</div>
      </dialog>

      <PublishReviewDialog draft={drafts.find(draft => draft.id === publishReviewDraftId) || null} brandName={brand.businessName} onCancel={() => setPublishReviewDraftId(null)} onConfirm={() => { if (publishReviewDraftId) void confirmPublishDraftNow(publishReviewDraftId); }} />

      {/* ========================================================================
         MODAL 5: LOGOUT CONFIRMATION DIALOG (modern-web-guidance: dialog)
         Native <dialog> without redundant role="dialog"/aria-modal, autoFocus on safe Cancel action
         ======================================================================== */}
      <dialog
        ref={logoutConfirmDialogRef}
        data-testid="logout-confirm-dialog"
        aria-labelledby="logout-confirm-title"
        aria-describedby="logout-confirm-desc"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            logoutConfirmDialogRef.current?.close();
          }
        }}
        className="m-auto w-full max-w-md rounded-xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-2xl"
      >
        <div className="space-y-5"><div className="flex items-center justify-between gap-4"><h2 id="logout-confirm-title" className="text-xl font-semibold">Keluar dari akun?</h2><button type="button" aria-label="Tutup konfirmasi keluar" onClick={() => logoutConfirmDialogRef.current?.close()} className="h-10 w-10 rounded-lg border border-neutral-200">×</button></div><p id="logout-confirm-desc" className="break-words text-base leading-relaxed text-neutral-500">Anda akan keluar dari {authUser?.email || 'akun Veloxa'}. Anda dapat masuk kembali kapan saja.</p><div className="flex flex-wrap justify-end gap-3 border-t border-neutral-100 pt-4"><button type="button" autoFocus onClick={() => logoutConfirmDialogRef.current?.close()} className="veloxa-button-secondary">Batal</button><button type="button" onClick={() => void handleConfirmSignOut()} className="veloxa-button-primary">Keluar akun</button></div></div>
      </dialog>
    </div>
  );
}
