'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import StudioMediaPreview from '@/components/StudioMediaPreview';
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
  extractStyleDnaFromReference,
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
import { VeloxaLuxuryLanding } from '@/components/VeloxaLuxuryLanding';
import { VeloxaExecutiveDashboardOverview } from '@/components/VeloxaExecutiveDashboardOverview';
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
  VaultDrawerType,
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
  const [metaAccount, setMetaAccount] = useState<MetaAdsAccountConnection>(INITIAL_META_ADS_ACCOUNT);
  const [vaultAssets, setVaultAssets] = useState<BrandVaultAsset[]>([]);
  const [autonomyConfig, setAutonomyConfig] = useState<AutonomyConfig>(INITIAL_AUTONOMY_CONFIG);
  const [eventCampaigns, setEventCampaigns] = useState<EventCampaign[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [metaAdCampaigns, setMetaAdCampaigns] = useState<MetaAdCampaignPlan[]>([]);

  // Studio form state
  const [studioFormat, setStudioFormat] = useState<ContentFormat>('single_post');
  const [isCreatingContent, setIsCreatingContent] = useState(false);
  const hydrationEpoch = useRef(0);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null);
  const [publishReviewDraftId, setPublishReviewDraftId] = useState<string | null>(null);
  const [selectedSourceAssetId, setSelectedSourceAssetId] = useState('');
  const [studioTopic, setStudioTopic] = useState<string>('');
  const [newAssetTitle, setNewAssetTitle] = useState<string>('');
  const [newAssetDrawer, setNewAssetDrawer] = useState<VaultDrawerType>('real_asset');
  const [newAssetMediaType, setNewAssetMediaType] = useState<'photo' | 'video_reel'>('photo');

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
    'Veloxa AI aktif · Seluruh 4 kanal sosmed (IG, FB, TikTok, YT Shorts) & AI Agent Meta Ads siap dijalankan.',
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
  const [authEmailInput, setAuthEmailInput] = useState<string>(SUPER_ADMIN_EMAIL);
  const [authPasswordInput, setAuthPasswordInput] = useState<string>('VeloxaAdmin2026!');

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

      try {
        const [meta, content, media] = await Promise.all([
          veloxaApi<{ connections: ChannelConnectionState[] }>(`/api/veloxa/meta/accounts?workspaceId=${encodeURIComponent(targetWsId)}`),
          veloxaApi<{ drafts: ContentDraft[]; quotaUsed: number }>(`/api/veloxa/content?workspaceId=${encodeURIComponent(targetWsId)}`),
          veloxaApi<{ assets: BrandVaultAsset[] }>(`/api/veloxa/media?workspaceId=${encodeURIComponent(targetWsId)}`),
        ]);
        if (epoch !== hydrationEpoch.current) return;
        setConnections(INITIAL_CHANNEL_CONNECTIONS.map(connection => meta.connections.find(item => item.channel === connection.channel) || { ...connection, connected: false, handle: '', accountName: 'Belum Terhubung', followerCount: 0, tokenExpiresAt: null, oauthMode: 'disconnected', lastPublishedAt: null }));
        setDrafts(previous => [...content.drafts, ...previous.filter(draft => !content.drafts.some(item => item.id === draft.id)).map(draft => draft.renderedMedia ? draft : { ...draft, status: 'draft' as const, publishedAtWib: undefined, channelStatuses: draft.channelStatuses.map(item => ({ channel: item.channel, status: 'pending' as const })) })]);
        setPostsUsedThisMonth(content.quotaUsed);
        setVaultAssets(previous => [...media.assets, ...previous.filter(asset => !media.assets.some(item => item.id === asset.id))]);
      } catch (error) {
        if (epoch !== hydrationEpoch.current) return;
        setConnections(INITIAL_CHANNEL_CONNECTIONS.map(connection => ({ ...connection, connected: false, handle: '', accountName: 'Belum Terhubung', followerCount: 0, tokenExpiresAt: null, oauthMode: 'disconnected', lastPublishedAt: null })));
        setStatusBanner(error instanceof Error ? error.message : 'Koneksi server belum siap.');
      }
      if (epoch !== hydrationEpoch.current) return;
      const callback = new URL(window.location.href);
      if (callback.searchParams.has('meta')) {
        setStatusBanner(callback.searchParams.get('meta') === 'connected' ? 'Izin Meta diterima. Pilih Page yang ingin digunakan untuk workspace ini.' : 'Koneksi Meta belum berhasil. Periksa izin aplikasi dan coba kembali.');
        oauthDialogRef.current?.showModal();
        callback.searchParams.delete('meta'); window.history.replaceState({}, '', callback.toString());
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

  const handleRealFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setStatusBanner('Mengunggah foto Brand Vault…');
      const form = new FormData(); form.set('workspaceId', brand.workspaceId); form.set('file', file);
      const result = await veloxaApi<{ asset: BrandVaultAsset }>('/api/veloxa/media', { method: 'POST', body: form });
      setVaultAssets(previous => [result.asset, ...previous]);
      setSelectedSourceAssetId(result.asset.id);
      setStatusBanner('Foto tersimpan. Anda dapat memakainya untuk membuat post tunggal.');
    } catch (error) { setStatusBanner(error instanceof Error ? error.message : 'Unggah foto gagal.'); }
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
      `Memutar Voiceover AI Bahasa Indonesia: "${res.scriptText.slice(0, 85)}..."`,
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

  const handleUploadVaultAsset = async (_useDevicePicker = false) => {
    if (newAssetMediaType !== 'photo') { setStatusBanner('Unggah video akan diaktifkan setelah alur post gambar selesai.'); return; }
    (document.getElementById('veloxa-real-file-upload') as HTMLInputElement | null)?.click();
  };

  const handleGenerateStudioDraft = async (_source: ContentDraft['source'] = 'manual_studio', scheduledSlotWib?: string) => {
    if (isCreatingContent) return;
    if (scheduledSlotWib) { setStatusBanner('Penjadwalan belum diaktifkan. Buat dan tinjau post tunggal di Studio dahulu.'); return; }
    setIsCreatingContent(true); setStatusBanner('Menyusun caption dan menyiapkan gambar post…');
    try {
      const saved = await syncWorkspaceSnapshotToStore({ brand, activePlanId, postsUsedThisMonth, connections, metaAccount, vaultAssets, autonomyConfig, eventCampaigns, drafts, metaAdCampaigns, tenants, updatedAtIso: new Date().toISOString() }, firebaseCfg, { forceCloudPush: true });
      if (!saved.syncedToFirestore) throw new Error('Perubahan workspace belum tersimpan ke cloud. Periksa koneksi lalu coba lagi.');
      const result = await veloxaApi<{ draft: ContentDraft; engineMode: string }>('/api/veloxa/content', { method: 'POST', body: JSON.stringify({ workspaceId: brand.workspaceId, topic: studioTopic.trim() || `Perkenalkan ${brand.businessName} di ${brand.city}`, format: studioFormat, ...(studioFormat === 'single_post' && selectedSourceAssetId ? { sourceAssetId: selectedSourceAssetId } : {}) }) });
      setDrafts(previous => [result.draft, ...previous]); setStudioTopic('');
      setStatusBanner(`Draf dan gambar siap ditinjau. ${result.engineMode === 'openai_live' ? 'Caption disusun dengan AI.' : 'Caption memakai template lokal; AI belum tersedia.'} Belum ada konten diterbitkan.`);
    } catch (error) { setStatusBanner(error instanceof Error ? error.message : 'Konten belum dapat dibuat.'); }
    finally { setIsCreatingContent(false); }
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
      {authUser && isWorkspaceLoading && <div className="fixed inset-0 z-[100] grid place-items-center bg-white" role="status" aria-live="polite"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-pink-100 border-t-[#D85A88]" /><p className="font-bold text-neutral-800">Menyiapkan workspace Anda…</p></div></div>}
      {/* Top Global Header — Ditampilkan pada Landing Page, Super Admin, & Mobile (<1024px). Pada Desktop User Workspace, Header menyatu di sisi kanan Sidebar Pink */}
      <header
        className={`sticky top-0 z-30 border-b border-neutral-200/80 bg-white/95 text-neutral-900 backdrop-blur ${
          isUserWorkspaceView ? 'lg:hidden' : ''
        }`}
      >
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
            <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-2xl bg-[#EC749B] font-black text-white shadow-xs shrink-0">
              V
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base sm:text-xl font-black tracking-tight text-neutral-900 whitespace-nowrap">
                VELOXA AI
              </span>
              {authUser &&
                (authUser.isSuperAdmin && activeRole === 'admin' ? (
                  <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[11px] font-bold text-[#D85A88]">
                    Super Admin Control Center
                  </span>
                ) : (
                  <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[11px] font-bold text-[#D85A88]">
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
              className="max-w-[136px] sm:max-w-none truncate rounded-xl sm:rounded-2xl border border-neutral-200 bg-white px-2.5 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-black text-neutral-800 shadow-2xs hover:border-pink-200 focus:border-[#EC749B] focus:outline-hidden"
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
                  className="rounded-xl sm:rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 sm:px-4 sm:py-2 text-[11px] sm:text-xs font-bold text-neutral-800 hover:border-pink-200 hover:text-[#D85A88] whitespace-nowrap"
                >
                  {i18nCopy.headerSignIn}
                </Link>
                <Link
                  href="/register"
                  data-testid="open-onboarding-public-btn"
                  className="hidden sm:inline-flex rounded-2xl bg-[#EC749B] px-4 py-2 text-xs font-black text-white shadow-xs hover:bg-[#DF608A] whitespace-nowrap"
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
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-pink-300 bg-pink-50/80 px-3.5 py-2 text-xs font-black text-[#D85A88] hover:bg-[#EC749B] hover:text-white"
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
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-pink-200 bg-pink-50/70 px-3 py-2 text-xs font-bold text-[#D85A88] hover:bg-pink-100/70"
                  >
                    <CreditCard className="h-3.5 w-3.5 text-[#EC749B]" />
                    {currentPlan.name} · {postsUsedThisMonth}/{currentPlan.monthlyPostQuota}
                  </button>
                )}

                <button
                  type="button"
                  data-testid="open-auth-modal-btn"
                  onClick={() => authDialogRef.current?.showModal()}
                  className="flex items-center gap-1.5 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                >
                  <Lock className="h-3.5 w-3.5 text-[#EC749B]" />
                  <span className="max-w-[140px] truncate sm:max-w-none">{authUser.email}</span>
                </button>

                <button
                  type="button"
                  data-testid="logout-btn"
                  onClick={handleRequestSignOutClick}
                  className="rounded-2xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-600 hover:border-pink-200 hover:text-[#D85A88]"
                >
                  {i18nCopy.headerLogout}
                </button>
              </>
            )}
          </div>
        </div>
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
            <VeloxaLuxuryLanding
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
              <div className="flex flex-col justify-between gap-4 rounded-3xl border border-neutral-200/80 bg-white p-6 text-neutral-900 shadow-2xs sm:flex-row sm:items-center">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#EC749B]" /> Super Admin Control Center ({authUser.email})
                  </span>
                  <h1 className="veloxa-hero-title mt-2 font-black tracking-tight text-neutral-900">
                    Manajemen Bisnis SaaS Veloxa AI
                  </h1>
                  <p className="mt-1 text-sm text-neutral-500">
                    Pantau pendapatan langganan (Rp500rb – Rp1,5jt), margin API AI, kuota pelanggan, dan kredensial OAuth terpusat.
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                    Gross Margin SaaS
                  </p>
                  <p className="text-3xl font-black text-[#D85A88]">{adminSummary.averageGrossMarginPct}%</p>
                  <p className="text-xs text-neutral-500">Target sehat: &gt;75%</p>
                </div>
              </div>

              {/* Admin KPI Row */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-xs font-bold uppercase text-neutral-400">Pendapatan Bulanan (MRR)</p>
                  <p className="mt-2 text-2xl font-black text-neutral-900">
                    {formatIdr(adminSummary.totalMrrIdr)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-neutral-500">
                    {tenants.length} bisnis aktif berlangganan
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-xs font-bold uppercase text-neutral-400">Modal API (OpenAI + Render)</p>
                  <p className="mt-2 text-2xl font-black text-neutral-900">
                    {formatIdr(adminSummary.totalApiCostIdr)}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Untuk {adminSummary.totalPublishedPosts} konten tayang bulan ini
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-xs font-bold uppercase text-neutral-400">Laba Bersih SaaS</p>
                  <p className="mt-2 text-2xl font-black text-[#D85A88]">
                    {formatIdr(adminSummary.totalNetProfitIdr)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-neutral-500">
                    Margin kotor {adminSummary.averageGrossMarginPct}%
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-2xs">
                  <p className="text-xs font-bold uppercase text-neutral-400">Kampanye AI Meta Ads</p>
                  <p className="mt-2 text-2xl font-black text-neutral-900">
                    {adminSummary.totalActiveMetaCampaigns} Aktif
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Ad spend ditarik langsung dari kartu user
                  </p>
                </div>
              </div>

              {/* Subscription Pricing Tiers Overview */}
              <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                <h2 className="text-lg font-black text-neutral-900">
                  Katalog Paket Langganan Veloxa AI (Rp500rb – Rp1,5 Juta)
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Pembayaran langganan dilakukan via Web (Midtrans/Xendit QRIS & VA) agar bebas potongan 30% App Store / Play Store.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {Object.values(SUBSCRIPTION_PLANS).map((plan) => (
                    <div
                      key={plan.id}
                      className={`rounded-2xl border p-5 ${
                        plan.id === 'pro_1500k'
                          ? 'border-pink-300 bg-white ring-2 ring-pink-100'
                          : 'border-neutral-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black text-neutral-900">{plan.name}</span>
                        {plan.id === 'pro_1500k' && (
                          <span className="rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-bold text-white">
                            TERLARIS
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-2xl font-black text-neutral-900">
                        {formatIdr(plan.priceMonthlyIdr)}
                        <span className="text-xs font-semibold text-neutral-400">/bulan</span>
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">{plan.tagline}</p>
                      <ul className="mt-3 space-y-1.5 text-xs text-neutral-600">
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
              <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 id="tenant-table-caption" className="text-lg font-black text-neutral-900">
                      Daftar Pelanggan (Tenants) & Kontrol Kuota
                    </h2>
                    <p className="text-xs text-neutral-500">
                      Ubah paket pelanggan secara instan, pantau margin pemakaian API, atau klik &ldquo;Inspeksi Workspace&rdquo; untuk mengecek studio brand pelanggan.
                    </p>
                  </div>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="tenant-table-caption"
                  className="veloxa-table-region rounded-2xl border border-neutral-200"
                >
                  <table className="text-left text-sm">
                    <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500">
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
                          <th className="px-4 py-3.5 font-bold text-neutral-900">
                            <div>{t.businessName}</div>
                            <div className="text-xs font-normal text-neutral-500">
                              {t.ownerName} · {t.ownerEmail}
                            </div>
                          </th>
                          <td className="px-4 py-3.5 text-xs font-semibold uppercase text-neutral-600">
                            {t.category.replace('_', ' ')}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-1 text-xs font-bold text-[#D85A88]">
                              {SUBSCRIPTION_PLANS[t.planId].name}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-xs font-bold text-neutral-900">
                            {t.postsPublishedThisMonth} / {t.monthlyPostQuota} post
                          </td>
                          <td className="px-4 py-3.5 text-xs text-neutral-600">
                            <div>{t.connectedChannels.length} Sosmed Aktif</div>
                            <div className="font-semibold text-[#D85A88]">
                              {t.metaAdsConnected ? `✓ ${t.activeMetaCampaigns} Kampanye Meta Ads` : 'Tanpa Meta Ads'}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-xs">
                            <div className="font-bold text-neutral-900">
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
                              className="rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-bold text-neutral-800"
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
                              className="rounded-xl border border-pink-200 bg-pink-50/70 px-3 py-1.5 text-xs font-bold text-[#D85A88] hover:bg-[#EC749B] hover:text-white"
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
              <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-[#EC749B]" />
                  <h2 className="text-lg font-black text-neutral-900">
                    Brankas API & OAuth Terpusat (Dikelola Pemilik SaaS)
                  </h2>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  User tidak perlu membuat API sendiri. Seluruh login Instagram, Facebook, TikTok, YouTube Shorts, dan Meta Ads memakai aplikasi resmi Veloxa AI di bawah ini.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-xs font-black uppercase text-neutral-400">OpenAI Master Engine</p>
                    <p className="mt-1 text-sm font-bold text-neutral-900">
                      {centralCreds.openAiModelText} · {centralCreds.openAiModelImage} · {centralCreds.openAiModelVoice}
                    </p>
                    <p className="mt-1 text-xs font-medium text-neutral-600">
                      <span className="font-bold text-[#D85A88]">✓ Aktif</span> · Batas Auto-Repair: {centralCreds.globalMaxRepairAttemptsPerJob}x/job
                    </p>
                  </div>
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-xs font-black uppercase text-neutral-400">Meta Graph & Marketing API</p>
                    <p className="mt-1 text-sm font-bold text-neutral-900">
                      App ID: {centralCreds.metaAppId}
                    </p>
                    <p className="mt-1 text-xs font-medium text-neutral-600">
                      <span className="font-bold text-[#D85A88]">✓ Advanced Access</span> (IG + FB + ads_management)
                    </p>
                  </div>
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-xs font-black uppercase text-neutral-400">TikTok & YouTube Shorts</p>
                    <p className="mt-1 text-sm font-bold text-neutral-900">
                      TikTok Direct Post · YT Quota {centralCreds.youtubeDailyQuotaUnits.toLocaleString('id-ID')}/hari
                    </p>
                    <p className="mt-1 text-xs font-medium text-neutral-600">
                      <span className="font-bold text-[#D85A88]">✓ Payment Gateway:</span> {centralCreds.paymentGatewayProvider} (QRIS & VA)
                    </p>
                  </div>
                </div>
              </section>

              {/* Cloud Firebase Database & 5 OpenAI Agents Configuration Panel (Cendekia-Style Architecture) */}
              <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                      Cloud Database & Multi-Agent OpenAI (Arsitektur Setara Cendekia)
                    </span>
                    <h2 className="mt-2 text-lg font-black text-neutral-900">
                      Koneksi Firebase Firestore & 5 OpenAI Agent Khusus Veloxa AI
                    </h2>
                    <p className="text-xs text-neutral-500">
                      Masukkan konfigurasi proyek Firebase baru Anda dan kunci OpenAI untuk mengaktifkan sinkronisasi database real-time & kelima Agent AI produksi.
                    </p>
                  </div>
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-bold text-neutral-700">
                    Status Sinkronisasi:{' '}
                    <span className="text-[#D85A88]">
                      {firebaseCfg.firebaseConnected ? '● Cloud Firestore Aktif' : '● Penyimpanan Lokal + Siap Tautkan Firebase'}
                    </span>
                  </span>
                </div>

                {/* Firebase & OpenAI Connection Inputs */}
                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="font-bold text-neutral-700">Firebase Project ID</label>
                    <input
                      type="text"
                      value={firebaseCfg.projectId}
                      onChange={(e) =>
                        setFirebaseCfg({
                          ...firebaseCfg,
                          projectId: e.target.value,
                          authDomain: `${e.target.value}.firebaseapp.com`,
                          storageBucket: `${e.target.value}.firebasestorage.app`,
                        })
                      }
                      placeholder="veloxa-ai-prod"
                      className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-neutral-700">Firebase Web API Key</label>
                    <input
                      type="password"
                      value={firebaseCfg.apiKey}
                      onChange={(e) => setFirebaseCfg({ ...firebaseCfg, apiKey: e.target.value })}
                      placeholder="AIzaSy..."
                      className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-neutral-700">OpenAI Master API Key</label>
                    <input
                      type="password"
                      value={openAiInputKey}
                      onChange={(e) => setOpenAiInputKey(e.target.value)}
                      placeholder={firebaseCfg.openAiApiKeyMasked || 'sk-proj-...'}
                      className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleSaveCloudConnectionConfig}
                      className="w-full rounded-xl bg-[#EC749B] px-4 py-2.5 font-black text-white shadow-2xs hover:bg-[#DF608A]"
                    >
                      Simpan & Sinkronkan Koneksi Cloud
                    </button>
                  </div>
                </div>

                {/* 5 Specialized OpenAI Agents Directory */}
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {Object.values(VELOXA_OPENAI_AGENTS).map((agt) => (
                    <div
                      key={agt.agentId}
                      className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-3.5 text-xs"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="rounded border border-pink-200 bg-pink-50/70 px-2 py-0.5 text-[10px] font-black text-[#D85A88]">
                            {agt.model}
                          </span>
                          <span className="text-[10px] font-bold text-[#D85A88]">● Siap</span>
                        </div>
                        <p className="mt-2 font-black text-neutral-900">{agt.name}</p>
                        <p className="mt-1 text-[11px] text-neutral-500">{agt.roleDescription}</p>
                      </div>
                      <p className="mt-2.5 border-t border-neutral-100 pt-2 font-mono text-[10px] text-neutral-400">
                        ID: {agt.agentId}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Local-First Cost Guard Telemetry Panel (Cendekia-Style Firestore Cost Optimization) */}
                <div
                  data-testid="local-first-telemetry-card"
                  className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
                        ★ Local-First Cost Guard (Arsitektur Hemat Firestore Setara Cendekia)
                      </span>
                      <h3 className="mt-1.5 text-sm font-black text-neutral-900">
                        Penghematan Biaya Read/Write Cloud Firestore: {firestoreSavingsPct}% Operasi Dihemat
                      </h3>
                      <p className="text-[11px] text-neutral-500">
                        Seluruh pembacaan UI memakai Local-First Cache (TTL 15 menit, 0ms latency) & penulisan memakai deduplikasi FNV-1a Hash sehingga dokumen yang sama tidak pernah ditulis ulang ke Firestore.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleForceCloudSync()}
                      className="rounded-xl bg-[#EC749B] px-3.5 py-2 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                    >
                      Push Snapshot ke Cloud Firestore Sekarang
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2.5 sm:grid-cols-4">
                    <div className="rounded-xl border border-neutral-200 bg-white p-3">
                      <span className="text-[11px] text-neutral-500">Local Reads/Writes (Rp0):</span>
                      <p className="mt-0.5 text-sm font-black text-neutral-900">
                        {localTelemetry.localReads} Read · {localTelemetry.localWrites} Write
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-white p-3">
                      <span className="text-[11px] text-neutral-500">Operasi Firestore Dihemat:</span>
                      <p className="mt-0.5 text-sm font-black text-[#D85A88]">
                        {localTelemetry.firestoreOpsSaved}x Read/Write Dicegah
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-white p-3">
                      <span className="text-[11px] text-neutral-500">FNV-1a Payload Fingerprint:</span>
                      <p className="mt-0.5 font-mono text-xs font-bold text-neutral-900">
                        {localTelemetry.lastPayloadHash}
                      </p>
                    </div>
                    <div className="rounded-xl border border-neutral-200 bg-white p-3">
                      <span className="text-[11px] text-neutral-500">Sinkronisasi Terakhir:</span>
                      <p className="mt-0.5 text-xs font-bold text-neutral-900">
                        {localTelemetry.lastCloudSyncWib || localTelemetry.lastLocalSaveWib}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            /* ======================================================================
               ROLE 2: LUXURY EXECUTIVE USER WORKSPACE DASHBOARD
               (FULL-HEIGHT SOLID PINK LEFT SIDEBAR FROM TOP TO BOTTOM + RIGHT HEADER)
               ====================================================================== */
            <div
              className="relative min-h-dvh w-full bg-[#F8F9FC]"
              data-testid="user-workspace-dashboard"
            >
              {/* ====================================================================
                 FULL-HEIGHT SOLID PINK LEFT SIDEMENU (TOP: 0 TO BOTTOM: 0, LEFT: 0)
                 ==================================================================== */}
              <aside
                data-testid="user-workspace-sidebar"
                aria-label="Sidebar Navigasi Workspace"
                className="bg-gradient-to-b from-[#E86691] via-[#DF5885] to-[#D14876] p-4 text-white shadow-xl lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-[268px] lg:flex-col lg:justify-between lg:overflow-y-auto lg:px-4 lg:py-5"
              >
                <div className="space-y-5">
                  {/* 1. Top Brand Logo inside Full-Height Pink Sidebar */}
                  <div className="flex items-center gap-3 px-1.5 pt-0.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 text-base font-black text-white shadow-xs ring-1 ring-white/35">
                      V
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[9px] font-extrabold uppercase tracking-[0.16em] text-pink-100">
                        AUTONOMOUS AI STUDIO
                      </p>
                      <p className="truncate text-lg font-black tracking-tight text-white leading-tight">
                        VELOXA AI
                      </p>
                    </div>
                  </div>

                  {/* 2. RUANG KERJA Frosted Glass Card inside Pink Sidebar */}
                  <div className="rounded-2xl border border-white/25 bg-white/12 p-3.5 backdrop-blur-xs">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-pink-100">
                      RUANG KERJA
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-white/25 bg-white/15 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-white">
                          {brand.businessName}
                        </p>
                        <p className="truncate text-[10px] font-medium text-pink-100">
                          {brand.city} · {currentPlan.name}
                        </p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-90 text-pink-100" />
                    </div>

                    {authUser?.isSuperAdmin ? (
                      <div className="mt-2">
                        <label htmlFor="workspace-preset-select" className="sr-only">
                          Pilih Inspeksi Brand
                        </label>
                        <select
                          id="workspace-preset-select"
                          value={selectedPresetKey}
                          onChange={(e) =>
                            handleSelectBrandPreset(
                              e.target.value as 'running_event' | 'cafe_fnb' | 'clinic_beauty' | 'custom',
                            )
                          }
                          className="w-full rounded-xl border border-white/30 bg-white/20 px-2.5 py-1.5 text-[11px] font-bold text-white focus:outline-hidden"
                        >
                          <option value="running_event" className="text-neutral-900">
                            🏃 Inspeksi: Nusantara Run
                          </option>
                          <option value="cafe_fnb" className="text-neutral-900">
                            ☕ Inspeksi: Kopi Senja
                          </option>
                          <option value="clinic_beauty" className="text-neutral-900">
                            ✨ Inspeksi: GlowDerm
                          </option>
                          <option value="custom" className="text-neutral-900">
                            🎨 Brand Aktif
                          </option>
                        </select>
                      </div>
                    ) : null}

                    <p className="mt-2.5 text-[11px] font-semibold text-pink-100">
                      {activeTab === 'overview'
                        ? 'Dashboard'
                        : activeTab === 'brand_vault'
                          ? 'Brand & Vault'
                          : activeTab === 'studio'
                            ? 'Content Studio'
                            : activeTab === 'autonomy'
                              ? 'Autonomy Engine'
                              : 'AI Meta Ads'}
                    </p>
                  </div>

                  {/* 3. NAVIGASI Section inside Pink Sidebar */}
                  <div>
                    <p className="px-2.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-pink-100/90">
                      NAVIGASI
                    </p>
                    <nav
                      aria-label="Menu Utama User Workspace"
                      data-testid="user-workspace-sidebar-nav"
                      className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1"
                    >
                      {(
                        [
                          {
                            id: 'overview',
                            label: 'Dashboard',
                            sublabel: i18nCopy.workspaceTabs.overview,
                            badge: `${connections.filter((c) => c.connected).length}/4`,
                            icon: LayoutDashboard,
                          },
                          {
                            id: 'brand_vault',
                            label: 'Brand & Vault',
                            sublabel: 'Brand Brain & Foto Asli',
                            badge: `${vaultAssets.length}`,
                            icon: Camera,
                          },
                          {
                            id: 'studio',
                            label: 'Content Studio',
                            sublabel: 'Reels 9:16, Carousel & Poster',
                            badge: `${drafts.length}`,
                            icon: Wand2,
                          },
                          {
                            id: 'autonomy',
                            label: 'Autonomy Engine',
                            sublabel: 'Jadwal Tayang & Mode Event',
                            badge: autonomyConfig.enabled ? 'ON' : 'OFF',
                            icon: Bot,
                          },
                          {
                            id: 'meta_ads',
                            label: 'AI Meta Ads',
                            sublabel: 'AI Media Buyer & Pagar Budget',
                            badge: `${metaAdCampaigns.filter((c) => c.status === 'active_running').length}`,
                            icon: Megaphone,
                          },
                        ] as const
                      ).map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            data-testid={`workspace-tab-${tab.id}`}
                            onClick={() => setActiveTab(tab.id)}
                            className={`group flex w-full items-center justify-between gap-2.5 rounded-xl px-3.5 py-2.5 text-left transition ${
                              isActive
                                ? 'bg-white text-[#D14876] shadow-md font-black'
                                : 'text-white/95 hover:bg-white/15 font-bold'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Icon
                                className={`h-4 w-4 shrink-0 ${
                                  isActive ? 'text-[#DF5885]' : 'text-white/90'
                                }`}
                              />
                              <span className="truncate text-xs leading-tight">{tab.label}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                                  isActive
                                    ? 'bg-pink-50 text-[#D14876] border border-pink-200'
                                    : 'bg-white/20 text-white'
                                }`}
                              >
                                {tab.badge}
                              </span>
                              {!isActive && (
                                <ChevronRight className="hidden h-3.5 w-3.5 text-white/70 lg:block" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </nav>
                  </div>
                </div>

                {/* Bottom Section of Full-Height Pink Sidemenu */}
                <div className="mt-5 space-y-2.5 border-t border-white/20 pt-4">
                  {/* Monthly Quota & Autopilot Progress Card */}
                  <div className="rounded-xl border border-white/25 bg-white/12 p-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-pink-50">Kuota Konten AI</span>
                      <span className="font-black text-white">
                        {postsUsedThisMonth}/{currentPlan.monthlyPostQuota} Tayang
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                      <div
                        className="h-full rounded-full bg-white transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              6,
                              Math.round((postsUsedThisMonth / Math.max(1, currentPlan.monthlyPostQuota)) * 100),
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-pink-100">
                      <span>{connections.filter((c) => c.connected).length}/4 Sosmed Aktif</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCheckoutPlanId(activePlanId);
                          billingDialogRef.current?.showModal();
                        }}
                        className="font-black text-white underline-offset-2 hover:underline"
                      >
                        Upgrade Paket →
                      </button>
                    </div>
                  </div>

                  {/* Quick Actions in Pink Sidebar */}
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab('studio')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-xs font-black text-[#D14876] shadow-sm hover:bg-pink-50 transition"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      <span>Buat Konten AI Baru</span>
                    </button>

                    <button
                      type="button"
                      data-testid="header-connect-social-btn"
                      onClick={() => handleOpenOAuthConfigModal('facebook')}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/30 bg-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/25 transition"
                    >
                      <span>🔗 Hubungkan 4 Sosmed</span>
                    </button>

                    <Link
                      href="/onboarding?edit=1"
                      data-testid="open-onboarding-modal-btn"
                      className="flex w-full items-center justify-center gap-1 rounded-xl border border-white/20 bg-transparent px-2.5 py-1.5 text-[11px] font-semibold text-pink-50 hover:bg-white/10 transition"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Edit Profil Brand</span>
                    </Link>
                  </div>
                </div>
              </aside>

              {/* ====================================================================
                 RIGHT MAIN WORKSPACE CONTENT COLUMN (WITH MATCHING TOP HEADER & SUMMARY)
                 ==================================================================== */}
              <div
                className="min-w-0 lg:pl-[268px]"
                data-testid="user-workspace-main"
              >
                {statusBanner && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mb-4 rounded-2xl border border-pink-100 bg-pink-50/70 px-4 py-3 text-sm font-semibold leading-relaxed text-neutral-800 shadow-sm"
                  >
                    {statusBanner}
                  </div>
                )}
                <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-4 sm:px-6 lg:px-7">
                  {/* 1. Right Top Header Bar (Matching Reference Image Header) */}
                  <div
                    data-testid="workspace-right-header"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200/90 bg-white px-4 py-3 sm:px-5 shadow-2xs"
                  >
                    {/* Left: Sidebar Icon Box + WORKSPACE + Active Page Title */}
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50/80 text-neutral-600">
                        <LayoutDashboard className="h-4 w-4 text-[#D85A88]" />
                      </div>
                      <div>
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">
                          WORKSPACE
                        </p>
                        <h1 className="text-lg sm:text-xl font-black tracking-tight text-neutral-900 leading-tight">
                          {activeTab === 'overview'
                            ? 'Dashboard'
                            : activeTab === 'brand_vault'
                              ? 'Brand & Vault'
                              : activeTab === 'studio'
                                ? 'Content Studio'
                                : activeTab === 'autonomy'
                                  ? 'Autonomy Engine'
                                  : 'AI Meta Ads'}
                        </h1>
                      </div>
                    </div>

                    {/* Right: Quick Action Pill + Data Siap + Tersinkron + Language + Profile Pill + Keluar */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenOAuthConfigModal('facebook')}
                        className="hidden xl:inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50/80 px-3.5 py-1.5 text-xs font-semibold text-neutral-500 hover:border-pink-200 hover:text-[#D85A88] transition"
                      >
                        <span>🔗 Koneksi 4 Sosmed ({connections.filter((c) => c.connected).length}/4)</span>
                      </button>

                      <span
                        data-testid="real-firestore-workspace-badge"
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-xs font-extrabold text-emerald-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Data siap</span>
                      </span>

                      <button
                        type="button"
                        data-testid="local-first-sync-btn"
                        onClick={() => void handleForceCloudSync()}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-100/80 transition"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Tersinkron</span>
                      </button>

                      <select
                        aria-label="Pilih Bahasa Workspace"
                        value={locale}
                        onChange={(e) => handleSelectLocale(e.target.value as VeloxaLocale)}
                        className="rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-extrabold text-neutral-700 hover:border-pink-200 focus:outline-hidden"
                      >
                        {VELOXA_LOCALES.map((loc) => (
                          <option key={loc.code} value={loc.code}>
                            {loc.flag} {loc.code.toUpperCase()} ({loc.currencyCode})
                          </option>
                        ))}
                      </select>

                      {/* User Profile Pill (Matching Reference Image: Avatar + Name + Role) */}
                      <button
                        type="button"
                        onClick={() => authDialogRef.current?.showModal()}
                        className="flex items-center gap-2.5 rounded-full border border-neutral-200 bg-neutral-50/70 py-1 pl-1.5 pr-3.5 text-left hover:border-pink-200 transition"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-[#D14876] shadow-2xs ring-1 ring-neutral-200">
                          {brand.businessName.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="hidden sm:block leading-tight">
                          <p className="max-w-[140px] truncate text-xs font-black text-neutral-900 uppercase">
                            {authUser?.displayName || brand.businessName}
                          </p>
                          <p className="text-[10px] font-semibold text-neutral-500">
                            Pemilik / Admin
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={handleRequestSignOutClick}
                        className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-600 hover:border-pink-200 hover:text-[#D85A88] transition"
                      >
                        {i18nCopy.headerLogout}
                      </button>
                    </div>
                  </div>

                  {/* 2. RINGKASAN HARI INI — Welcome Banner + INSIGHT CEPAT (Matching Reference Image) */}
                  <div className="flex flex-col justify-between gap-4 rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-2xs lg:flex-row lg:items-center">
                    <div className="flex items-start sm:items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#EC749B] text-lg font-black text-white shadow-sm">
                        {brand.businessName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#D85A88]">
                          RINGKASAN HARI INI
                        </p>
                        <h2 className="mt-0.5 text-lg sm:text-xl font-black tracking-tight text-neutral-900">
                          Selamat Datang di {brand.businessName} ({brand.city})
                        </h2>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                          <span>
                            Pemilik:{' '}
                            <strong className="font-bold text-neutral-800 uppercase">
                              {authUser?.displayName || brand.businessName}
                            </strong>
                          </span>
                          <span>·</span>
                          <span>Unit Usaha:</span>
                          <span className="rounded-md border border-pink-200 bg-pink-50 px-2 py-0.5 text-[11px] font-extrabold text-[#D85A88]">
                            {brand.businessName} · {brand.city}
                          </span>
                          {connections
                            .filter((c) => c.connected)
                            .map((conn) => (
                              <span
                                key={conn.channel}
                                className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700"
                              >
                                ✓ {CHANNEL_META[conn.channel].shortLabel}: {conn.handle}
                              </span>
                            ))}
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                          <span>
                            Cakupan:{' '}
                            <strong className="text-neutral-900">
                              {connections.filter((c) => c.connected).length} dari 4 sosmed aktif
                            </strong>{' '}
                            <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600">
                              {currentPlan.name}
                            </span>
                          </span>
                          <span>•</span>
                          <span>
                            Konten Tayang:{' '}
                            <strong className="text-neutral-900">{postsUsedThisMonth}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Kampanye Meta Ads:{' '}
                            <strong className="text-neutral-900">{metaAdCampaigns.length}</strong>{' '}
                            <span className="rounded bg-pink-50 px-1.5 py-0.5 text-[9px] font-black text-[#D85A88] uppercase">
                              BULAN INI
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right Side: INSIGHT CEPAT Box (Matching Reference Image) */}
                    <div className="rounded-2xl border border-pink-200/80 bg-pink-50/50 p-3.5 lg:w-[370px] shrink-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#D85A88]">
                          ⚡ INSIGHT CEPAT
                        </span>
                        <span className="rounded-md bg-[#EC749B] px-2 py-0.5 text-[9px] font-black uppercase text-white">
                          PEMILIK
                        </span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-pink-100 bg-white p-2.5 shadow-2xs">
                          <p className="text-[9px] font-bold uppercase text-neutral-400">
                            KANAL SOSMED AKTIF
                          </p>
                          <p className="mt-0.5 truncate text-xs font-black text-neutral-900">
                            {connections.filter((c) => c.connected).length > 0
                              ? connections
                                  .filter((c) => c.connected)
                                  .map((c) => c.handle || CHANNEL_META[c.channel].shortLabel)
                                  .join(', ')
                              : 'Belum ada (0/4)'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-pink-100 bg-white p-2.5 shadow-2xs">
                          <p className="text-[9px] font-bold uppercase text-neutral-400">
                            PRIORITAS HARI INI
                          </p>
                          <p className="mt-0.5 truncate text-xs font-black text-[#D85A88]">
                            {connections.filter((c) => c.connected).length > 0
                              ? 'Siap Buat Konten AI'
                              : 'Hubungkan 4 Sosmed'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

              {/* ====================================================================
                 TAB 1: EXECUTIVE ANALYTICS OVERVIEW, CHARTS & 4-CHANNEL COMMAND HUB
                 ==================================================================== */}
              {activeTab === 'overview' && (
                <VeloxaExecutiveDashboardOverview
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
                <div className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                    {/* Brand Brain Configuration */}
                    <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                      <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                        Brand Brain · Otak Identitas Bisnis
                      </span>
                      <h2 className="mt-2 text-lg font-black text-neutral-900">
                        Pengaturan Karakter & Produk Unggulan
                      </h2>
                      <p className="text-xs text-neutral-500">
                        AI Agent mempelajari profil ini agar setiap naskah, visual, dan voiceover Reels terasa 100% khas bisnis Anda.
                      </p>

                      <div className="mt-4 space-y-3.5 text-xs">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="font-bold text-neutral-700">Nama Bisnis / Acara</label>
                            <input
                              type="text"
                              value={brand.businessName}
                              onChange={(e) => setBrand({ ...brand, businessName: e.target.value })}
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-neutral-700">Kota / Target Area</label>
                            <input
                              type="text"
                              value={brand.city}
                              onChange={(e) => setBrand({ ...brand, city: e.target.value })}
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="font-bold text-neutral-700">Target Audiens</label>
                          <input
                            type="text"
                            value={brand.targetAudience}
                            onChange={(e) => setBrand({ ...brand, targetAudience: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-neutral-700">Gaya Bahasa & Tone Merek</label>
                          <input
                            type="text"
                            value={brand.brandTone}
                            onChange={(e) => setBrand({ ...brand, brandTone: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-neutral-700">
                            Produk / Menu / Event Unggulan Utama
                          </label>
                          <input
                            type="text"
                            value={brand.offerings[0]?.title || ''}
                            onChange={(e) => {
                              const first = brand.offerings[0] || {
                                id: 'off_1',
                                category: 'product' as const,
                                priceLabel: 'Promo Spesial',
                                highlight: '',
                              };
                              setBrand({
                                ...brand,
                                offerings: [{ ...first, title: e.target.value }, ...brand.offerings.slice(1)],
                              });
                            }}
                            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-neutral-700">Ajakan Bertindak (Default CTA)</label>
                          <input
                            type="text"
                            value={brand.defaultCta}
                            onChange={(e) => setBrand({ ...brand, defaultCta: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
                          />
                        </div>

                        <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5">
                          <input
                            type="checkbox"
                            checked={brand.prioritizeRealAssets}
                            onChange={(e) =>
                              setBrand({ ...brand, prioritizeRealAssets: e.target.checked })
                            }
                            className="h-4 w-4 accent-[#EC749B]"
                          />
                          <span>
                            <strong className="block text-neutral-900">
                              Prioritaskan Foto & Klip Video Asli Saya di Setiap Konten AI
                            </strong>
                            <span className="text-neutral-500">
                              AI akan mengambil foto menu cafe / foto pelari asli dari Laci 2 dan memadukannya dengan tipografi & voiceover otomatis.
                            </span>
                          </span>
                        </label>
                      </div>
                    </section>

                    {/* Upload to Dual Brand Vault */}
                    <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                      <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                        Dual Brand Vault · Web, Kamera Android & iOS
                      </span>
                      <h2 className="mt-2 text-lg font-black text-neutral-900">
                        Upload Contoh Referensi atau Dokumentasi Asli
                      </h2>
                      <p className="text-xs text-neutral-500">
                        Unggah contoh poster/Reels yang Anda sukai (untuk ditiru gayanya oleh AI) atau stok foto/video asli bisnis Anda.
                      </p>

                      <div className="mt-4 space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setNewAssetDrawer('style_reference')}
                            className={`rounded-xl border p-3 text-left font-bold transition ${
                              newAssetDrawer === 'style_reference'
                                ? 'border-[#EC749B] bg-pink-50/50 text-neutral-900'
                                : 'border-neutral-200 bg-white text-neutral-600'
                            }`}
                          >
                            <Sparkles className="mb-1 h-4 w-4 text-[#EC749B]" />
                            Laci 1: Contoh Referensi Gaya (Style DNA)
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewAssetDrawer('real_asset')}
                            className={`rounded-xl border p-3 text-left font-bold transition ${
                              newAssetDrawer === 'real_asset'
                                ? 'border-[#EC749B] bg-pink-50/50 text-neutral-900'
                                : 'border-neutral-200 bg-white text-neutral-600'
                            }`}
                          >
                            <Camera className="mb-1 h-4 w-4 text-[#EC749B]" />
                            Laci 2: Foto / Video Asli Milik Bisnis
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="font-bold text-neutral-700">Jenis Media</label>
                            <select
                              value={newAssetMediaType}
                              onChange={(e) =>
                                setNewAssetMediaType(e.target.value as 'photo' | 'video_reel')
                              }
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
                            >
                              <option value="photo">Foto / Poster / Carousel</option>
                              <option value="video_reel">Video Reels / TikTok (9:16)</option>
                            </select>
                          </div>
                          <div>
                            <label className="font-bold text-neutral-700">Judul / Catatan Aset</label>
                            <input
                              type="text"
                              placeholder="Misal: Foto Pelari 10K / Kopi Susu"
                              value={newAssetTitle}
                              onChange={(e) => setNewAssetTitle(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-neutral-900"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => void handleUploadVaultAsset(false)}
                            className="flex-1 rounded-xl bg-[#EC749B] px-4 py-3 font-black text-white shadow-2xs hover:bg-[#DF608A]"
                          >
                            <Upload className="mr-1.5 inline h-4 w-4" />
                            Simpan ke {newAssetDrawer === 'style_reference' ? 'Laci Referensi Gaya' : 'Galeri Aset Asli'}
                          </button>
                          <label
                            htmlFor="veloxa-real-file-upload"
                            data-testid="real-file-upload-label"
                            className="cursor-pointer rounded-xl border border-pink-200 bg-pink-50/70 px-3.5 py-3 font-bold text-[#D85A88] hover:bg-pink-100/70"
                          >
                            <Upload className="mr-1 inline h-4 w-4 text-[#EC749B]" />
                            Pilih File Laptop/HP
                            <input
                              id="veloxa-real-file-upload"
                              data-testid="real-file-upload-input"
                              type="file"
                              accept="image/*,video/*"
                              onChange={handleRealFileInputChange}
                              className="sr-only"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => void handleUploadVaultAsset(true)}
                            className="rounded-xl border border-neutral-200 bg-white px-3.5 py-3 font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                          >
                            <Camera className="mr-1 inline h-4 w-4 text-[#EC749B]" />
                            Kamera HP
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* Vault Gallery Display */}
                  <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                    <h3 className="text-base font-black text-neutral-900">
                      Isi Brand Vault Anda ({vaultAssets.length} Aset Tersimpan)
                    </h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {vaultAssets.map((asset) => (
                        <article
                          key={asset.id}
                          className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"
                        >
                          <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100">
                            <img
                              src={asset.previewUrl}
                              alt={asset.title}
                              className="h-full w-full object-cover"
                            />
                            <span
                              className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                                asset.drawer === 'style_reference'
                                  ? 'bg-[#EC749B] text-white shadow-2xs'
                                  : 'border border-neutral-200 bg-white/95 text-neutral-800'
                              }`}
                            >
                              {asset.drawer === 'style_reference' ? '★ Referensi Gaya' : '✓ Aset Asli User'}
                            </span>
                            <span className="absolute bottom-2 right-2 rounded-md border border-neutral-200 bg-white/95 px-2 py-0.5 text-[10px] font-bold text-neutral-800">
                              {asset.mediaType === 'video_reel' ? 'Reels 9:16' : 'Foto 4:5'} · via {asset.uploadedFrom.toUpperCase()}
                            </span>
                          </div>
                          <div className="p-3.5 text-xs">
                            <h4 className="font-black text-neutral-900">{asset.title}</h4>
                            <p className="mt-1 text-neutral-500">{asset.description}</p>
                            {asset.extractedStyleDna && (
                              <div className="mt-2.5 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 text-[11px] text-neutral-700">
                                <strong className="text-[#D85A88]">Style DNA Diekstrak AI:</strong>
                                <p className="mt-0.5">• Layout: {asset.extractedStyleDna.layoutPattern}</p>
                                <p>• Hook: {asset.extractedStyleDna.hookFormula}</p>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {/* ====================================================================
                 TAB 3: STUDIO KONTEN MULTI-PLATFORM (IG, FB, TIKTOK, YOUTUBE SHORTS)
                 ==================================================================== */}
              {activeTab === 'studio' && (
                <div className="space-y-6">
                  <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                          Studio Konten AI · Self-Healing Quality Gate
                        </span>
                        <h2 className="mt-2 text-lg font-black text-neutral-900">
                          Buat Konten Baru Sesuai Referensi & Aset {brand.businessName}
                        </h2>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div>
                        <label className="text-xs font-bold text-neutral-700">Format Konten</label>
                        <select
                          value={studioFormat}
                          onChange={(e) => { setStudioFormat(e.target.value as ContentFormat); if (e.target.value === 'carousel') setSelectedSourceAssetId(''); }}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs font-bold text-neutral-900"
                        >
                          <option value="short_video" disabled>
                            Video Pendek 9:16 (IG Reels + FB Reels + TikTok + YT Shorts)
                          </option>
                          <option value="carousel">
                            Carousel 5 Slide 4:5 (Instagram + Facebook)
                          </option>
                          <option value="single_post">
                            Post Tunggal 4:5 (Instagram + Facebook)
                          </option>
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-xs font-bold text-neutral-700">
                          Topik / Brief Khusus (Kosongkan bila ingin AI memilih otomatis dari Brand Brain & Event)
                        </label>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            placeholder={`Contoh: Promo ${brand.offerings[0]?.title || brand.businessName} minggu ini...`}
                            value={studioTopic}
                            onChange={(e) => setStudioTopic(e.target.value)}
                            className="flex-1 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs text-neutral-900"
                          />
                          <button
                            type="button"
                            disabled={isCreatingContent}
                            onClick={() => handleGenerateStudioDraft('manual_studio')}
                            className="shrink-0 rounded-xl bg-[#EC749B] px-5 py-2.5 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                          >
                            <Sparkles className="mr-1.5 inline h-4 w-4" />
                            Buat & Periksa Otomatis
                          </button>
                        </div>
                      </div>
                    </div>
                    {studioFormat === 'carousel' && <p className="mt-3 text-xs text-neutral-600">Lima gambar AI akan dibuat. Tinjau seluruh slide sebelum terbit. Satu carousel memakai satu kuota publikasi. Foto Brand Vault tersedia untuk post tunggal.</p>}
                    <label className="mt-4 block text-xs font-bold text-neutral-700">Foto Brand Vault (opsional)
                      <select disabled={studioFormat === 'carousel'} value={selectedSourceAssetId} onChange={event => setSelectedSourceAssetId(event.target.value)} className="mt-1 block w-full rounded-xl border p-3">
                        <option value="">Buat gambar AI dengan Sunburst</option>
                        {vaultAssets.filter(asset => /^[a-f0-9-]{36}$/.test(asset.id) && asset.mediaType === 'photo').map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
                      </select>
                    </label>
                    <p className="mt-3 text-xs text-neutral-500">Post tunggal dan carousel 5 slide tersedia untuk Instagram/Facebook. Reels dan jadwal otomatis belum diaktifkan.</p>
                  </section>

                  {/* Generated Drafts List */}
                  <div className="space-y-4">
                    {drafts.map((draft) => (
                      <article
                        key={draft.id}
                        className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-black text-[#D85A88]">
                                {draft.status === 'published' ? '✓ Sudah Tayang' : draft.status === 'needs_attention' ? 'Perlu diperiksa di Meta' : draft.status === 'partially_published' ? 'Sebagian kanal berhasil' : draft.status === 'publish_failed' ? 'Publikasi gagal' : draft.status === 'publishing' ? 'Sedang mengirim' : 'Draf — tinjau sebelum terbit'}
                              </span>
                              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-xs font-bold text-neutral-700">
                                {draft.format === 'short_video'
                                  ? `Video 9:16 (${draft.videoDurationSeconds || 28} dtk)`
                                  : draft.format === 'carousel'
                                    ? `Carousel (${draft.slides?.length || 4} Slide)`
                                    : 'Post Tunggal'}
                              </span>
                              {draft.usedRealAssetIds.length > 0 && (
                                <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-bold text-neutral-700">
                                  ★ Memakai {draft.usedRealAssetIds.length} Foto/Video Asli User
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 text-base font-black text-neutral-900">{draft.title}</h3>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {draft.status !== 'published' && (
                              <button
                                type="button"
                                disabled={!!publishingDraftId || !draft.qualityReview.passed || ['needs_attention', 'publishing'].includes(draft.status) || (draft.format === 'carousel' ? draft.renderedSlides?.length !== 5 : !draft.renderedMedia)}
                                onClick={() => handlePublishDraftNow(draft.id)}
                                className="rounded-xl bg-[#EC749B] px-4 py-2 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                              >
                                <Send className="mr-1.5 inline h-3.5 w-3.5" />
                                {draft.status === 'partially_published' ? 'Coba lagi kanal yang gagal' : `Terbitkan ke ${draft.targetChannels.length} Sosmed Sekarang`}
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid={`download-poster-btn-${draft.id}`}
                              onClick={() => {
                                if (draft.renderedMedia) {
                                  window.open(draft.renderedMedia.url, '_blank', 'noopener,noreferrer');
                                  setStatusBanner('Gambar JPEG final dibuka. Gunakan menu simpan gambar pada perangkat Anda.');
                                } else {
                                  downloadDraftPosterSvg(draft, brand);
                                  setStatusBanner('Template SVG draf lama dibuka untuk diunduh. Buat ulang melalui Studio untuk menyiapkan JPEG publikasi.');
                                }
                              }}
                              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                            >
                              <Download className="mr-1.5 inline h-3.5 w-3.5 text-[#EC749B]" />
                              Unduh Visual Poster
                            </button>
                            <button
                              type="button"
                              data-testid={`play-voiceover-btn-${draft.id}`}
                              onClick={() => handlePlayDraftVoiceover(draft)}
                              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                            >
                              <Volume2 className="mr-1.5 inline h-3.5 w-3.5 text-[#EC749B]" />
                              {playingVoiceoverDraftId === draft.id
                                ? 'Hentikan Voiceover AI'
                                : 'Putar Voiceover AI (ID)'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDesignMetaAdsWithAi(draft)}
                              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                            >
                              <Megaphone className="mr-1.5 inline h-3.5 w-3.5 text-[#EC749B]" />
                              Jadikan Materi Meta Ads
                            </button>
                          </div>
                        </div>

                        {/* Live Rendered Visual Poster / Carousel Preview + Quality Gate */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
                          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-2">
                            <StudioMediaPreview draft={draft} fallbackUrl={buildRenderedVisualSvgDataUrl({ brand, draft, slideIndex: 0 })} />
                          </div>
                          <div className="space-y-3">
                            {/* Quality Gate Proof */}
                            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 text-xs text-neutral-800">
                              <div className="flex items-center justify-between font-bold text-neutral-900">
                                <span>
                                  <span className="text-[#D85A88]">✓ Self-Healing Quality Gate:</span> {draft.qualityReview.score}/100 ({draft.qualityReview.issues.length} Masalah Tersisa)
                                </span>
                                <span className="text-neutral-500">Iterasi perbaikan: {draft.qualityReview.repairAttempts}x</span>
                              </div>
                              <p className="mt-1 text-neutral-600">{draft.qualityReview.summary}</p>
                            </div>

                            {/* Multi-Channel Distribution Badges */}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-bold text-neutral-500">Distribusi Lintas Platform:</span>
                              {draft.channelStatuses.map((cs) => (
                                <span
                                  key={cs.channel}
                                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${CHANNEL_META[cs.channel].badgeClass}`}
                                >
                                  {CHANNEL_META[cs.channel].shortLabel}:{' '}
                                  <span className="text-[#D85A88]">
                                    {cs.status === 'published' ? '✓ Sudah Tayang' : cs.status === 'failed' ? 'Gagal dikirim' : cs.status === 'unknown' ? 'Perlu diperiksa' : 'Belum diterbitkan'}
                                    {cs.permalink && <a href={cs.permalink} target="_blank" rel="noopener noreferrer" className="ml-2 underline">Lihat posting ↗</a>}
                                    {cs.note && <span className="ml-2 text-red-700">{cs.note}</span>}
                                  </span>
                                </span>
                              ))}
                            </div>
                            <p className="whitespace-pre-line rounded-xl border border-neutral-100 bg-white p-3 text-xs text-neutral-600">
                              <strong className="text-neutral-900">Caption Siap Kirim:</strong> {[draft.caption, draft.hashtags.join(' ')].filter(Boolean).join('\n\n')}
                            </p>
                          </div>
                        </div>

                        {/* Storyboard / Slides Preview — Clean White Cards */}
                        {draft.videoScenes && (
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {draft.videoScenes.map((scene) => (
                              <div
                                key={scene.sceneNumber}
                                className="flex flex-col justify-between rounded-2xl border border-neutral-200 bg-white p-4 text-xs text-neutral-900"
                              >
                                <div>
                                  <div className="flex items-center justify-between text-[11px] font-bold text-[#D85A88]">
                                    <span>ADEGAN {scene.sceneNumber}</span>
                                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-600">
                                      {scene.timeRange}
                                    </span>
                                  </div>
                                  <p className="mt-2 font-black text-neutral-900">{scene.textOverlay}</p>
                                  <p className="mt-2 text-[11px] text-neutral-600">
                                    <strong className="text-neutral-800">VO:</strong> &ldquo;{scene.voiceover}&rdquo;
                                  </p>
                                </div>
                                <p className="mt-3 border-t border-neutral-100 pt-2 text-[10px] text-neutral-500">
                                  Visual: {scene.visualDirection}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {draft.slides && (
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {draft.slides.map((slide) => (
                              <div
                                key={slide.slideNumber}
                                className="rounded-2xl border border-neutral-200 bg-white p-4 text-xs"
                              >
                                <div className="flex items-center justify-between font-bold text-[#D85A88]">
                                  <span>SLIDE 0{slide.slideNumber}</span>
                                  <span className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-600">
                                    {slide.badgeText}
                                  </span>
                                </div>
                                <p className="mt-2 font-black text-neutral-900">{slide.headline}</p>
                                <p className="mt-1 text-neutral-600">{slide.body}</p>
                                <p className="mt-2 border-t border-neutral-100 pt-2 text-[10px] text-neutral-400">
                                  {!draft.renderedMedia && slide.visualDirection}
                                </p>
                              </div>
                            ))}
                          </div>
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
                    <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                          Agent Konten Otonom 24/7
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setStatusBanner('Penjadwalan otomatis belum diaktifkan. Gunakan Studio untuk meninjau dan menerbitkan post tunggal dahulu.')
                          }
                          className={`rounded-full px-3.5 py-1 text-xs font-black ${
                            autonomyConfig.enabled
                              ? 'bg-[#EC749B] text-white shadow-2xs'
                              : 'border border-neutral-200 bg-neutral-100 text-neutral-600'
                          }`}
                        >
                          {autonomyConfig.enabled ? '● Otonom Aktif' : '○ Dijeda'}
                        </button>
                      </div>

                      <h2 className="mt-2 text-lg font-black text-neutral-900">
                        Atur Sendiri Frekuensi & Jam Posting Harian Anda
                      </h2>
                      <p className="text-xs text-neutral-500">
                        Agent akan memilih ide topik, memadukan foto/video dari Brand Vault, memeriksa kualitas sampai 0 masalah, dan menerbitkan otomatis ke kanal Anda.
                      </p>

                      <div className="mt-4 space-y-4 text-xs">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="font-bold text-neutral-700">
                              Frekuensi Posting per Hari
                            </label>
                            <select
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
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-bold text-neutral-900"
                            >
                              <option value={1}>1x Sehari (30 konten/bulan)</option>
                              <option value={2}>2x Sehari · Pagi & Malam (60 konten/bulan)</option>
                              <option value={3}>3x Sehari · Pagi, Siang, Malam (90 konten/bulan)</option>
                              <option value={4}>4x Sehari · Agresif Kampanye</option>
                            </select>
                          </div>

                          <div>
                            <label className="font-bold text-neutral-700">Mode Kepercayaan Otonom</label>
                            <select
                              value={autonomyConfig.executionMode}
                              onChange={(e) =>
                                setAutonomyConfig({
                                  ...autonomyConfig,
                                  executionMode: e.target.value as AutonomyConfig['executionMode'],
                                })
                              }
                              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-bold text-neutral-900"
                            >
                              <option value="full_autonomous">
                                100% Full Otonom (Langsung Tayang Tanpa Disentuh)
                              </option>
                              <option value="copilot_review">
                                Co-Pilot H-1 (Kirim Notif WA/HP Sebelum Tayang)
                              </option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="font-bold text-neutral-700">
                            Jam Tayang Otomatis (WIB): {autonomyConfig.scheduleTimesWib.join(' · ')} WIB
                          </label>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {autonomyConfig.scheduleTimesWib.map((slot, idx) => (
                              <input
                                key={idx}
                                type="time"
                                value={slot}
                                onChange={(e) => {
                                  const next = [...autonomyConfig.scheduleTimesWib];
                                  next[idx] = e.target.value;
                                  setAutonomyConfig({ ...autonomyConfig, scheduleTimesWib: next });
                                }}
                                className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 font-bold text-neutral-900"
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4">
                          <p className="font-bold text-neutral-800">
                            Komposisi Pilar Konten Otomatis:
                          </p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
                              <span className="text-lg font-black text-[#D85A88]">
                                {autonomyConfig.contentMixPct.educationTips}%
                              </span>
                              <p className="text-[11px] text-neutral-500">Edukasi & Tips</p>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
                              <span className="text-lg font-black text-neutral-900">
                                {autonomyConfig.contentMixPct.communityStory}%
                              </span>
                              <p className="text-[11px] text-neutral-500">Cerita & Testimoni</p>
                            </div>
                            <div className="rounded-xl border border-neutral-200 bg-white p-2.5">
                              <span className="text-lg font-black text-neutral-900">
                                {autonomyConfig.contentMixPct.productEventPromo}%
                              </span>
                              <p className="text-[11px] text-neutral-500">Promo Produk/Event</p>
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
                          className="w-full rounded-2xl bg-[#EC749B] py-3 font-black text-white shadow-2xs hover:bg-[#DF608A]"
                        >
                          <Bot className="mr-1.5 inline h-4 w-4 text-white" />
                          Jalankan 1 Slot Agent Otonom Sekarang (Simulasi Produksi & Jadwal)
                        </button>
                      </div>
                    </section>

                    {/* Event Campaign Countdown Manager */}
                    <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                      <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                        Mode Kampanye Event & Promo Terjadwal
                      </span>
                      <h2 className="mt-2 text-lg font-black text-neutral-900">
                        Kalender Hitung Mundur Event (Teaser → Early Bird → Hari-H)
                      </h2>
                      <p className="text-xs text-neutral-500">
                        Sangat cocok untuk Event Lari, Launching Menu Baru Cafe, atau Promo Tanggal Kembar.
                      </p>

                      <div className="mt-4 space-y-3 text-xs">
                        {eventCampaigns.map((camp) => {
                          const phase = computeEventCampaignPhase(camp.eventDateIso);
                          return (
                            <div
                              key={camp.id}
                              className="rounded-2xl border border-neutral-200 bg-white p-4"
                            >
                              <div className="flex items-center justify-between">
                                <span className="rounded-full bg-[#EC749B] px-2.5 py-0.5 text-[10px] font-bold text-white">
                                  {phase.phaseLabel}
                                </span>
                                <span className="font-bold text-neutral-600">
                                  Target: {camp.currentConversions}/{camp.targetRegistrationsOrSales} pendaftar/pembeli
                                </span>
                              </div>
                              <h3 className="mt-2 text-sm font-black text-neutral-900">{camp.name}</h3>
                              <p className="mt-0.5 text-neutral-600">{camp.ticketOrPromoHighlight}</p>
                              <p className="mt-1.5 text-[11px] font-semibold text-[#D85A88]">
                                Arahan AI Hari Ini: {phase.contentAngleDirective}
                              </p>
                            </div>
                          );
                        })}

                        <div className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-3.5">
                          <p className="font-bold text-neutral-900">+ Tambah Kampanye Event Baru</p>
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
                            className="mt-2 w-full rounded-xl bg-[#EC749B] py-2.5 font-bold text-white shadow-2xs hover:bg-[#DF608A]"
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
                  {/* AI Meta Ads Campaign Designer */}
                  <section className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                          AI Agent Marketing · Terhubung ke Meta Marketing API
                        </span>
                        <h2 className="mt-2 text-lg font-black text-neutral-900">
                          Rancang, Susun Demografi & Interest, dan Eksekusi Meta Ads Otomatis
                        </h2>
                        <p className="text-xs text-neutral-500">
                          AI memvalidasi ID Interest resmi di Meta Graph API, memetakan radius lokasi, membagi A/B testing materi iklan, dan menjaga budget di bawah pagar pengaman Anda.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="font-bold text-neutral-700">Tujuan Kampanye (Objective)</label>
                        <select
                          value={adObjective}
                          onChange={(e) => setAdObjective(e.target.value as MetaAdObjective)}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-bold text-neutral-900"
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
                        <label className="font-bold text-neutral-700">Produk / Event yang Diiklankan</label>
                        <input
                          type="text"
                          value={adPromoTitle}
                          onChange={(e) => setAdPromoTitle(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-semibold text-neutral-900"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-neutral-700">
                          Kota Target & Radius (km)
                        </label>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            value={adCity}
                            onChange={(e) => setAdCity(e.target.value)}
                            className="w-2/3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-semibold text-neutral-900"
                          />
                          <input
                            type="number"
                            value={adRadiusKm}
                            min={3}
                            max={80}
                            onChange={(e) => setAdRadiusKm(Number(e.target.value))}
                            className="w-1/3 rounded-xl border border-neutral-200 bg-white px-2.5 py-2.5 font-bold text-neutral-900"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-bold text-neutral-700">
                          Rentang Usia Demografi ({adAgeMin} – {adAgeMax} thn)
                        </label>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="number"
                            value={adAgeMin}
                            min={18}
                            max={55}
                            onChange={(e) => setAdAgeMin(Number(e.target.value))}
                            className="w-1/2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-bold text-neutral-900"
                          />
                          <input
                            type="number"
                            value={adAgeMax}
                            min={20}
                            max={65}
                            onChange={(e) => setAdAgeMax(Number(e.target.value))}
                            className="w-1/2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-bold text-neutral-900"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-bold text-neutral-700">
                          Kata Kunci Interest Tambahan
                        </label>
                        <input
                          type="text"
                          value={adCustomInterest}
                          onChange={(e) => setAdCustomInterest(e.target.value)}
                          placeholder="Misal: Strava, Kopi Gayo, Skincare"
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-neutral-700">Budget Harian (IDR)</label>
                        <input
                          type="number"
                          step={25000}
                          value={adDailyBudgetIdr}
                          onChange={(e) => setAdDailyBudgetIdr(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-black text-neutral-900"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-neutral-700">Durasi Tayang (Hari)</label>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={adDurationDays}
                          onChange={(e) => setAdDurationDays(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-bold text-neutral-900"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-[#D85A88]">
                          Pagar Pengaman Budget Harian
                        </label>
                        <input
                          type="number"
                          step={25000}
                          value={metaAccount.dailyHardCapIdr}
                          onChange={(e) =>
                            setMetaAccount({
                              ...metaAccount,
                              dailyHardCapIdr: Number(e.target.value),
                            })
                          }
                          className="mt-1 w-full rounded-xl border border-pink-200 bg-white px-3 py-2.5 font-black text-neutral-900"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2">
                      <p className="text-xs text-neutral-500">
                        Estimasi total anggaran: <strong className="text-neutral-900">{formatIdr(Math.min(adDailyBudgetIdr, metaAccount.dailyHardCapIdr) * adDurationDays)}</strong> ({adDurationDays} hari) · Ditarik langsung oleh Meta dari akun iklan <code>{metaAccount.adAccountId}</code>.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleDesignMetaAdsWithAi()}
                        className="rounded-2xl bg-[#EC749B] px-6 py-3 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                      >
                        <Sparkles className="mr-1.5 inline h-4 w-4" />
                        Rancang & Susun Kampanye Meta Ads dengan AI
                      </button>
                    </div>
                  </section>

                  {/* Active & Draft AI Meta Ads Campaigns */}
                  <div className="space-y-5">
                    {metaAdCampaigns.map((camp) => (
                      <article
                        key={camp.id}
                        className="veloxa-luxury-card veloxa-dashboard-panel rounded-3xl border border-neutral-200/90 bg-white p-6"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full border px-3 py-0.5 text-xs font-black ${
                                  camp.status === 'active_running'
                                    ? 'border-pink-200 bg-pink-50/70 text-[#D85A88]'
                                    : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                                }`}
                              >
                                {camp.status === 'active_running'
                                  ? '● ACTIVE · Sedang Tayang di Meta Ads'
                                  : '⏸ PAUSED · Siap Diluncurkan 1-Klik'}
                              </span>
                              <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-bold text-neutral-600">
                                Objective: {camp.objective.replace('_', ' ')}
                              </span>
                              {camp.budget.hardCapClamped && (
                                <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-bold text-[#D85A88]">
                                  ✓ Dijaga Pagar Budget ({formatIdr(camp.budget.appliedDailyBudgetIdr)}/hari)
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 text-lg font-black text-neutral-900">
                              {camp.campaignName}
                            </h3>
                            <p className="text-xs text-neutral-500">
                              Tujuan Klik: <code>{camp.destinationUrlOrWa}</code> · Total Anggaran {camp.budget.durationDays} Hari:{' '}
                              <strong className="text-neutral-900">{formatIdr(camp.budget.totalBudgetIdr)}</strong>
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleMetaCampaignRun(camp.id)}
                              className={`rounded-xl px-4 py-2.5 text-xs font-black transition ${
                                camp.status === 'active_running'
                                  ? 'border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]'
                                  : 'bg-[#EC749B] text-white shadow-2xs hover:bg-[#DF608A]'
                              }`}
                            >
                              {camp.status === 'active_running'
                                ? 'Jeda Kampanye'
                                : 'Setujui & Jalankan Iklan di Meta'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRunMetaAutoOptimizer(camp.id)}
                              className="rounded-xl bg-[#EC749B] px-4 py-2.5 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                            >
                              <Zap className="mr-1.5 inline h-3.5 w-3.5 text-white" />
                              Jalankan Optimasi AI Media Buyer
                            </button>
                          </div>
                        </div>

                        {/* 3 Pillars of Meta Ads: Demographics, Validated Interests, Budget & Outcome */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
                          {/* Column 1: Demografi & Geo */}
                          <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-xs">
                            <p className="font-black uppercase tracking-wider text-neutral-400">
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
                          <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-xs">
                            <p className="font-black uppercase tracking-wider text-neutral-400">
                              2. Sisi Interest Resmi Meta API
                            </p>
                            <div className="mt-2.5 space-y-2">
                              {camp.validatedInterests.slice(0, 3).map((interest) => (
                                <div
                                  key={interest.id}
                                  className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-2.5"
                                >
                                  <div className="flex items-center justify-between font-bold text-neutral-900">
                                    <span>{interest.name}</span>
                                    <span className="text-[10px] text-[#D85A88]">
                                      ID #{interest.id.slice(-5)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-neutral-500">
                                    Ukuran audiens: {(interest.audienceSizeLower / 1_000_000).toFixed(1)}M –{' '}
                                    {(interest.audienceSizeUpper / 1_000_000).toFixed(1)}M orang
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Column 3: Sisi Budget & Estimasi Hasil */}
                          <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-xs">
                            <p className="font-black uppercase tracking-wider text-neutral-400">
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
                                <strong className="text-[#D85A88]">
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
                              className={`rounded-2xl border p-4 text-xs ${
                                cr.status === 'winner_scaled'
                                  ? 'border-pink-300 bg-white ring-1 ring-pink-100'
                                  : cr.status === 'paused_by_ai_loser'
                                    ? 'border-neutral-200 bg-neutral-50 opacity-75'
                                    : 'border-neutral-200 bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-black text-neutral-900">{cr.variantLabel}</span>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                                    cr.status === 'winner_scaled'
                                      ? 'bg-[#EC749B] text-white'
                                      : cr.status === 'paused_by_ai_loser'
                                        ? 'border border-neutral-200 bg-white text-neutral-500'
                                        : 'border border-pink-200 bg-pink-50/70 text-[#D85A88]'
                                  }`}
                                >
                                  {cr.status === 'winner_scaled'
                                    ? `★ PEMENANG · Alokasi Budget ${cr.budgetSharePct}%`
                                    : cr.status === 'paused_by_ai_loser'
                                      ? '✕ DIMATIKAN AI (Biaya Mahal)'
                                      : `Alokasi Budget ${cr.budgetSharePct}%`}
                                </span>
                              </div>
                              <p className="mt-1.5 font-bold text-neutral-900">{cr.headline}</p>
                              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-500">
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
                          <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 text-xs">
                            <p className="font-black text-neutral-900">
                              Riwayat Tindakan Otonom AI Media Buyer:
                            </p>
                            <ul className="mt-2 space-y-1.5 text-neutral-600">
                              {camp.optimizationLogs.map((log) => (
                                <li key={log.id} className="flex items-start gap-2">
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EC749B]" />
                                  <span>
                                    <strong className="text-neutral-900">[{log.timestampWib}]</strong> {log.summary} (Efisiensi anggaran:{' '}
                                    <strong className="text-[#D85A88]">{formatIdr(log.savedOrReallocatedIdr)}/hari</strong>)
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
                </div>
              </div>
            </div>
          )}

          {authUser && (
            <footer
              data-testid="veloxa-workspace-footer"
              className={`mt-10 rounded-3xl border border-neutral-200/80 bg-white px-6 py-4 text-xs text-neutral-500 shadow-2xs ${
                !(authUser.isSuperAdmin && activeRole === 'admin')
                  ? 'mx-4 sm:mx-7 lg:ml-[312px] lg:mr-9'
                  : ''
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#EC749B] text-[11px] font-black text-white">
                    V
                  </span>
                  <span className="font-bold text-neutral-800">
                    © 2026 Veloxa AI Global Cloud · Web, Android (.apk) & iOS Native
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold">
                  <span className="text-[#D85A88]">● 5 OpenAI Agents & 4 Social APIs Active</span>
                  <span>Local-First Hemat {firestoreSavingsPct}% Firestore</span>
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
              className="flex-1 rounded-2xl border border-neutral-200 bg-white py-2.5 text-center text-xs font-black text-neutral-800"
            >
              {i18nCopy.headerSignIn}
            </Link>
            <Link
              href="/register"
              className="flex-[1.4] rounded-2xl bg-[#EC749B] py-2.5 text-center text-xs font-black text-white shadow-xs"
            >
              {i18nCopy.headerStartFree} →
            </Link>
          </nav>
        ) : (
          activeRole === 'user' && (
            <nav
              aria-label="Bottom Navigation Android dan iOS"
              data-testid="mobile-workspace-bottom-nav"
              className="veloxa-native-bottom-nav fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 gap-1 border-t border-neutral-200/90 bg-white/95 px-2.5 pt-2 shadow-lg backdrop-blur md:hidden"
            >
              {(
                [
                  { id: 'overview', label: i18nCopy.mobileTabs.overview, icon: LayoutDashboard },
                  { id: 'brand_vault', label: i18nCopy.mobileTabs.brand_vault, icon: Camera },
                  { id: 'studio', label: i18nCopy.mobileTabs.studio, icon: Wand2 },
                  { id: 'autonomy', label: i18nCopy.mobileTabs.autonomy, icon: Bot },
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
                    className={`flex flex-col items-center gap-1 rounded-2xl py-1.5 text-[10px] font-black transition ${
                      isActive
                        ? 'bg-pink-50/90 text-[#EC749B] ring-1 ring-pink-200'
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
        className="w-full max-w-lg rounded-3xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
              Tahap 1 · Onboarding Workspace Pelanggan Baru
            </span>
            <h2 id="onboarding-dialog-title" className="mt-1 text-lg font-black text-neutral-900">
              Daftarkan Brand / Bisnis Baru ke Veloxa AI
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onboardingDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-600 hover:text-neutral-900"
          >
            Tutup
          </button>
        </div>

        <form onSubmit={handleCompleteNewBusinessOnboarding} className="mt-4 space-y-3 text-xs">
          <div>
            <label htmlFor="onboard-biz-name" className="font-bold text-neutral-700">
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
              <label htmlFor="onboard-category" className="font-bold text-neutral-700">
                Kategori Industri
              </label>
              <select
                id="onboard-category"
                value={onboardCategory}
                onChange={(e) => setOnboardCategory(e.target.value as BusinessCategory)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-bold text-neutral-900"
              >
                <option value="cafe_fnb">Cafe, Resto & F&B</option>
                <option value="running_event">Event Lari / Konser / EO</option>
                <option value="clinic_beauty">Klinik Kecantikan & Kesehatan</option>
                <option value="fashion_retail">Fashion & Retail Lokal</option>
                <option value="custom">Bisnis Kustom Lainnya</option>
              </select>
            </div>
            <div>
              <label htmlFor="onboard-city" className="font-bold text-neutral-700">
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
            <label htmlFor="onboard-offering" className="font-bold text-neutral-700">
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
              <label htmlFor="onboard-email" className="font-bold text-neutral-700">
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
              <label htmlFor="onboard-plan" className="font-bold text-neutral-700">
                Paket Langganan Awal
              </label>
              <select
                id="onboard-plan"
                value={onboardPlanId}
                onChange={(e) => setOnboardPlanId(e.target.value as SubscriptionPlanId)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-bold text-neutral-900"
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
              className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold text-neutral-700"
            >
              Batal
            </button>
            <button
              type="submit"
              data-testid="submit-onboarding-btn"
              className="rounded-xl bg-[#EC749B] px-5 py-2.5 font-black text-white shadow-2xs hover:bg-[#DF608A]"
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
        className="m-auto w-full max-w-xl rounded-3xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 pb-3.5">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/80 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
              🔗 WIZARD KONEKSI 4 SOSMED &amp; OAUTH 2.0 RESMI
            </span>
            <h2 id="oauth-dialog-title" className="mt-1.5 text-lg font-black text-neutral-900">
              {editingChannel === 'facebook' || editingChannel === 'instagram'
                ? `Hubungkan Facebook & Instagram ke ${brand.businessName}`
                : `Hubungkan ${CHANNEL_META[editingChannel].label} ke ${brand.businessName}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => oauthDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-bold text-neutral-600 hover:border-pink-200 hover:text-[#D85A88]"
          >
            Tutup ✕
          </button>
        </div>

        {/* 4-Channel Switcher Tabs inside Modal so User Can Connect All 4 Channels Easily */}
        <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(['facebook', 'instagram', 'tiktok', 'youtube_shorts'] as const).map((ch) => {
            const connItem = connections.find((c) => c.channel === ch);
            const isSelected = editingChannel === ch;
            return (
              <button
                key={ch}
                type="button"
                data-testid={`oauth-tab-${ch}`}
                onClick={() => populateOAuthModalFieldsForChannel(ch)}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-black transition ${
                  isSelected
                    ? 'border-[#EC749B] bg-pink-50/80 text-[#D85A88] ring-1 ring-pink-200'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-pink-200'
                }`}
              >
                <span className="truncate">{CHANNEL_META[ch].shortLabel}</span>
                <span
                  className={`ml-1 text-[10px] ${
                    connItem?.connected ? 'text-emerald-600' : 'text-neutral-400'
                  }`}
                >
                  {connItem?.connected ? '● Aktif' : '○ Off'}
                </span>
              </button>
            );
          })}
        </div>

        {authUser && <VeloxaMetaConnections key={brand.workspaceId} workspaceId={brand.workspaceId} onConnections={verified => {
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
        className="w-full max-w-xl rounded-3xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
              Tahap 4 · Pembayaran Langganan Web (Bebas Potongan 30% App Store)
            </span>
            <h2 id="billing-dialog-title" className="mt-1 text-lg font-black text-neutral-900">
              Pilih / Upgrade Paket Langganan Veloxa AI
            </h2>
          </div>
          <button
            type="button"
            onClick={() => billingDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-600"
          >
            Tutup
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-2">
            {Object.values(SUBSCRIPTION_PLANS).map((plan) => (
              <button
                key={plan.id}
                type="button"
                data-testid={`select-plan-btn-${plan.id}`}
                onClick={() => setSelectedCheckoutPlanId(plan.id)}
                className={`rounded-2xl border p-3 text-left transition ${
                  selectedCheckoutPlanId === plan.id
                    ? 'border-[#EC749B] bg-pink-50/50 ring-1 ring-pink-200'
                    : 'border-neutral-200 bg-white'
                }`}
              >
                <p className="font-black text-neutral-900">{plan.name}</p>
                <p className="mt-1 text-sm font-black text-[#D85A88]">
                  {formatIdr(plan.priceMonthlyIdr)}
                </p>
                <p className="mt-0.5 text-[10px] text-neutral-500">
                  {plan.monthlyPostQuota} Konten/bln
                </p>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethodTab('qris')}
                  className={`rounded-xl px-3 py-1.5 font-bold ${
                    paymentMethodTab === 'qris'
                      ? 'bg-[#EC749B] text-white'
                      : 'border border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  QRIS Instan (Semua Bank / E-Wallet)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethodTab('va_bca')}
                  className={`rounded-xl px-3 py-1.5 font-bold ${
                    paymentMethodTab === 'va_bca'
                      ? 'bg-[#EC749B] text-white'
                      : 'border border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  BCA / Mandiri Virtual Account
                </button>
              </div>
              <span className="font-black text-neutral-900">
                Total: {formatIdr(SUBSCRIPTION_PLANS[selectedCheckoutPlanId].priceMonthlyIdr)}
              </span>
            </div>

            {paymentMethodTab === 'qris' ? (
              <div className="mt-3 flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-3">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 font-mono text-[10px] font-black text-neutral-800">
                  [QRIS VLX]
                </div>
                <div>
                  <p className="font-black text-neutral-900">
                    NMID: ID2026VELOXAAISAAS · PT Veloxa Kreasi AI
                  </p>
                  <p className="mt-0.5 text-neutral-500">
                    Scan dengan BCA Mobile, Livin Mandiri, GoPay, OVO, atau ShopeePay. Kuota {SUBSCRIPTION_PLANS[selectedCheckoutPlanId].monthlyPostQuota} postingan/bulan aktif otomatis.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-neutral-500">Nomor BCA Virtual Account:</p>
                <p className="font-mono text-base font-black text-neutral-900">88012 0812 9900 441</p>
              </div>
            )}
          </div>

          {billingReceipts.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="font-bold text-neutral-800">Riwayat Pembayaran Terakhir:</p>
              <p className="mt-1 text-[11px] text-neutral-600">
                ✓ {billingReceipts[0].id} · {billingReceipts[0].workspaceName} ·{' '}
                <strong>{billingReceipts[0].planName}</strong> ({formatIdr(billingReceipts[0].amountIdr)}) —{' '}
                <span className="font-bold text-[#D85A88]">{billingReceipts[0].paidAtWib}</span>
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => billingDialogRef.current?.close()}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-bold text-neutral-700"
            >
              Tutup
            </button>
            <button
              type="button"
              data-testid="confirm-qris-payment-btn"
              onClick={() => void handleConfirmQrisSubscriptionUpgrade()}
              className="rounded-xl bg-[#EC749B] px-5 py-2.5 font-black text-white shadow-2xs hover:bg-[#DF608A]"
            >
              ✓ Simulasikan Pembayaran Lunas QRIS (Aktifkan Paket Instan)
            </button>
          </div>
        </div>
      </dialog>

      {/* ========================================================================
         STAGE 5A MODAL: FIREBASE AUTHENTICATION (GOOGLE & EMAIL/PASSWORD LOGIN)
         ======================================================================== */}
      <dialog
        ref={authDialogRef}
        aria-labelledby="auth-dialog-title"
        data-testid="firebase-auth-dialog"
        className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
              Autentikasi Resmi Veloxa AI (veloxa-ai-saas)
            </span>
            <h2 id="auth-dialog-title" className="mt-1 text-lg font-black text-neutral-900">
              Masuk ke Akun Veloxa AI
            </h2>
          </div>
          <button
            type="button"
            onClick={() => authDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-600"
          >
            Tutup
          </button>
        </div>

        <div className="mt-4 space-y-3.5 text-xs">
          {authUser ? (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3">
              <p className="text-[11px] text-neutral-500">Sedang Login Sebagai:</p>
              <p className="font-black text-neutral-900">
                {authUser.displayName} ({authUser.email})
              </p>
              <span className="mt-1 inline-block rounded-full border border-pink-200 bg-pink-50/80 px-2.5 py-0.5 text-[10px] font-bold text-[#D85A88]">
                {authUser.isSuperAdmin ? '★ Super Admin (Owner SaaS)' : '✓ Pelanggan Bisnis (Workspace)'}
              </span>
            </div>
          ) : (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3 text-neutral-600">
              Masuk dengan email bisnis Anda untuk membuka <strong>Workspace Pelanggan</strong>, atau masuk dengan <code>sosrospg@gmail.com</code> untuk membuka <strong>Super Admin Control Center</strong>.
            </div>
          )}

          <button
            type="button"
            data-testid="google-signin-btn"
            onClick={() => void handleGoogleSignInClick()}
            className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 font-black text-neutral-800 shadow-2xs hover:border-pink-200 hover:text-[#D85A88]"
          >
            G · Masuk dengan Google (Firebase OAuth)
          </button>

          <form onSubmit={(e) => void handleEmailSignInSubmit(e)} className="space-y-2.5 border-t border-neutral-100 pt-3">
            <div>
              <label htmlFor="auth-email-input" className="font-bold text-neutral-700">
                Email Akun
              </label>
              <input
                id="auth-email-input"
                data-testid="auth-email-input"
                type="email"
                required
                value={authEmailInput}
                onChange={(e) => setAuthEmailInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
              />
            </div>
            <div>
              <label htmlFor="auth-password-input" className="font-bold text-neutral-700">
                Kata Sandi
              </label>
              <input
                id="auth-password-input"
                data-testid="auth-password-input"
                type="password"
                required
                minLength={6}
                value={authPasswordInput}
                onChange={(e) => setAuthPasswordInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
              />
            </div>
            <button
              type="submit"
              data-testid="email-signin-submit-btn"
              className="w-full rounded-xl bg-[#EC749B] py-2.5 font-black text-white shadow-2xs hover:bg-[#DF608A]"
            >
              Masuk dengan Email & Kata Sandi
            </button>
          </form>

          {/* Quick 1-Click Role Login for Instant Testing */}
          <div className="space-y-2 border-t border-neutral-100 pt-3">
            <p className="text-[11px] font-bold text-neutral-500">
              Akses Cepat 1-Klik (Pilih Akun Sesuai Peran):
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                data-testid="quick-login-user-btn"
                onClick={() => handleQuickLoginRole('user')}
                className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left font-bold text-neutral-800 hover:border-pink-200 hover:text-[#D85A88]"
              >
                <span className="block text-[11px] font-black text-neutral-900">
                  🏢 Masuk sebagai Pelanggan
                </span>
                <span className="block text-[10px] text-neutral-500">
                  owner@nusantararun.id
                </span>
              </button>
              <button
                type="button"
                data-testid="quick-login-admin-btn"
                onClick={() => handleQuickLoginRole('admin')}
                className="rounded-xl border border-pink-200 bg-pink-50/60 px-3 py-2.5 text-left font-bold text-[#D85A88] hover:bg-[#EC749B] hover:text-white"
              >
                <span className="block text-[11px] font-black">
                  🔑 Masuk sebagai Super Admin
                </span>
                <span className="block text-[10px] opacity-80">
                  sosrospg@gmail.com
                </span>
              </button>
            </div>
          </div>
        </div>
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
        className="m-auto w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-2xl"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/80 px-3 py-1 text-[11px] font-black text-[#D85A88]">
                <Lock className="h-3.5 w-3.5 text-[#EC749B]" />
                KONFIRMASI KEAMANAN SESI
              </span>
              <h2 id="logout-confirm-title" className="mt-2 text-lg font-black text-neutral-900">
                Konfirmasi Keluar Akun (Logout)
              </h2>
            </div>
            <button
              type="button"
              onClick={() => logoutConfirmDialogRef.current?.close()}
              aria-label="Tutup dialog konfirmasi keluar"
              className="rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-bold text-neutral-600 hover:border-pink-200 hover:text-[#D85A88]"
            >
              ✕
            </button>
          </div>

          <p id="logout-confirm-desc" className="text-xs leading-relaxed text-neutral-600">
            Apakah Anda yakin ingin keluar dari sesi akun{' '}
            <strong className="text-neutral-900">{authUser?.email || 'Veloxa AI'}</strong>? Seluruh data profil brand{' '}
            <strong className="text-[#EC749B]">{brand.businessName}</strong>, progres onboarding, serta aset studio Anda telah tersimpan aman di Cloud Firestore (<code>veloxa-ai-saas</code>).
          </p>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-800">
            <div className="flex items-center gap-2 font-black">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>Status Onboarding & Data Cloud Tersinkron</span>
            </div>
            <p className="mt-1 text-[11px] text-emerald-700">
              Saat Anda login kembali nanti, Anda akan langsung masuk ke Dashboard Workspace ini tanpa perlu mengisi ulang form Onboarding.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2.5 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              autoFocus
              data-testid="cancel-logout-btn"
              onClick={() => logoutConfirmDialogRef.current?.close()}
              className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xs font-black text-neutral-800 hover:border-pink-200 hover:text-[#D85A88] transition"
            >
              Batal, Tetap di Dashboard
            </button>
            <button
              type="button"
              data-testid="confirm-logout-submit-btn"
              onClick={() => void handleConfirmSignOut()}
              className="veloxa-luxury-card-pink rounded-2xl bg-[#EC749B] px-5 py-3 text-xs font-black text-white hover:bg-[#DF608A] transition"
            >
              Ya, Keluar Akun Sekarang
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
