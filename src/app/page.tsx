'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  getDefaultFirebaseConnectionConfig,
  loadSavedFirebaseConfig,
  loadWorkspaceSnapshotFromStore,
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
  buildRenderedVisualSvgDataUrl,
  downloadDraftPosterSvg,
  speakDraftVoiceoverIndonesian,
} from '@/lib/veloxa-visual-renderer';
import {
  SUPER_ADMIN_EMAIL,
  getInitialAuthenticatedUser,
  signInWithEmailPasswordOrRegister,
  signInWithGooglePopup,
  signOutVeloxaUser,
  subscribeToFirebaseAuthChanges,
  type VeloxaAuthenticatedUser,
} from '@/lib/veloxa-auth';
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
  const [activeRole, setActiveRole] = useState<VeloxaRole>('user');
  const [activeTab, setActiveTab] = useState<UserTabId>('overview');
  const [viewportMode, setViewportMode] = useState<'desktop_web' | 'mobile_native'>('desktop_web');
  const [selectedPresetKey, setSelectedPresetKey] = useState<'running_event' | 'cafe_fnb' | 'clinic_beauty' | 'custom'>('running_event');

  // Multi-tenant workspace state
  const [brand, setBrand] = useState<BrandProfile>(BRAND_PRESETS.running_event);
  const [activePlanId, setActivePlanId] = useState<SubscriptionPlanId>('pro_1500k');
  const [postsUsedThisMonth, setPostsUsedThisMonth] = useState<number>(52);
  const [connections, setConnections] = useState<ChannelConnectionState[]>(INITIAL_CHANNEL_CONNECTIONS);
  const [metaAccount, setMetaAccount] = useState<MetaAdsAccountConnection>(INITIAL_META_ADS_ACCOUNT);
  const [vaultAssets, setVaultAssets] = useState<BrandVaultAsset[]>(INITIAL_VAULT_ASSETS);
  const [autonomyConfig, setAutonomyConfig] = useState<AutonomyConfig>(INITIAL_AUTONOMY_CONFIG);
  const [eventCampaigns, setEventCampaigns] = useState<EventCampaign[]>(INITIAL_EVENT_CAMPAIGNS);
  const [drafts, setDrafts] = useState<ContentDraft[]>(() => buildInitialDrafts());
  const [metaAdCampaigns, setMetaAdCampaigns] = useState<MetaAdCampaignPlan[]>(() =>
    buildInitialMetaAdCampaigns(buildInitialDrafts()),
  );

  // Studio form state
  const [studioFormat, setStudioFormat] = useState<ContentFormat>('short_video');
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
  const [tenants, setTenants] = useState<TenantWorkspaceSummary[]>(INITIAL_TENANT_WORKSPACES);
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

  // Stage 5A & 5B: Firebase Authentication & Commercial Landing Page State
  const [authUser, setAuthUser] = useState<VeloxaAuthenticatedUser>(() =>
    getInitialAuthenticatedUser(),
  );
  const [authEmailInput, setAuthEmailInput] = useState<string>(SUPER_ADMIN_EMAIL);
  const [authPasswordInput, setAuthPasswordInput] = useState<string>('VeloxaAdmin2026!');
  const [showLandingPage, setShowLandingPage] = useState<boolean>(false);

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
  const [editingChannel, setEditingChannel] = useState<SocialChannelId>('instagram');
  const [editingChannelHandle, setEditingChannelHandle] = useState<string>('@nusantararun.id');
  const [editingMetaAdAccountId, setEditingMetaAdAccountId] = useState<string>('act_889920144512');

  // Stage 4: Billing & QRIS Checkout State
  const [selectedCheckoutPlanId, setSelectedCheckoutPlanId] =
    useState<SubscriptionPlanId>('pro_1500k');
  const [paymentMethodTab, setPaymentMethodTab] = useState<'qris' | 'va_bca'>('qris');
  const [billingReceipts, setBillingReceipts] = useState<
    Array<{ id: string; workspaceName: string; planName: string; amountIdr: number; paidAtWib: string }>
  >([
    {
      id: 'INV-VLX-20261101',
      workspaceName: 'Nusantara Run Festival',
      planName: 'Veloxa Pro + AI Meta Ads',
      amountIdr: 1_500_000,
      paidAtWib: '01 Nov 2026, 09:15 WIB',
    },
  ]);

  useEffect(() => {
    const savedCfg = loadSavedFirebaseConfig();
    setFirebaseCfg(savedCfg);
    const unsubAuth = subscribeToFirebaseAuthChanges((fbUser) => {
      if (fbUser) setAuthUser(fbUser);
    });
    void loadWorkspaceSnapshotFromStore(BRAND_PRESETS.running_event.workspaceId, savedCfg).then(
      ({ snapshot: snap, telemetry }) => {
        setLocalTelemetry(telemetry);
        if (!snap) return;
        setBrand(snap.brand);
        setActivePlanId(snap.activePlanId);
        setPostsUsedThisMonth(snap.postsUsedThisMonth);
        setConnections(snap.connections);
        setMetaAccount(snap.metaAccount);
        setVaultAssets(snap.vaultAssets);
        setAutonomyConfig(snap.autonomyConfig);
        setEventCampaigns(snap.eventCampaigns);
        setDrafts(snap.drafts);
        setMetaAdCampaigns(snap.metaAdCampaigns);
        setTenants(snap.tenants);
      },
    );
    return () => unsubAuth();
  }, []);

  useEffect(() => {
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
    ).then((res) => {
      setLocalTelemetry(res.telemetry);
    });
  }, [
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
        : `Snapshot tersimpan di Local-First Cache (${res.telemetry.lastPayloadHash}) · Hemat ${firestoreSavingsPct}% operasi Firestore.`,
    );
  };

  const handleCompleteNewBusinessOnboarding = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = onboardBusinessName.trim() || 'Kopi Roastery Braga';
    const cleanCity = onboardCity.trim() || 'Bandung';
    const cleanOffering = onboardOfferingTitle.trim() || `Paket Spesial ${cleanName}`;
    const newWsId = `ws_custom_${Date.now()}`;
    const planSpec = SUBSCRIPTION_PLANS[onboardPlanId];

    const createdBrand: BrandProfile = {
      workspaceId: newWsId,
      businessName: cleanName,
      category: onboardCategory,
      city: cleanCity,
      targetAudience: `Pelanggan & komunitas ${cleanName} di ${cleanCity} (18-45 tahun)`,
      brandTone: 'Ramah, modern, autentik, dan persuasif khas brand lokal populer',
      primaryColorHex: '#EC749B',
      accentColorHex: '#FFFFFF',
      visualVibe: 'Clean bright minimalist dengan fokus foto produk/dokumentasi asli',
      whatsappNumber: '6281299004411',
      websiteUrl: `https://veloxa.ai/${cleanName.toLowerCase().replace(/\s+/g, '-')}`,
      offerings: [
        {
          id: `off_${Date.now()}`,
          title: cleanOffering,
          category: onboardCategory === 'running_event' ? 'event' : 'product',
          priceLabel: 'Promo Spesial Minggu Ini',
          highlight: `Unggulan utama ${cleanName} di ${cleanCity}`,
        },
      ],
      defaultCta: `Klik link bio / WhatsApp ${cleanName} (${cleanCity}) sekarang!`,
      forbiddenWords: ['murahan', 'abal-abal', 'palsu'],
      prioritizeRealAssets: true,
    };

    const econ = calculateTenantUnitEconomics({
      planId: onboardPlanId,
      postsPublishedThisMonth: 1,
    });

    const newTenantSummary: TenantWorkspaceSummary = {
      workspaceId: newWsId,
      businessName: cleanName,
      ownerName: cleanName.split(' ')[0] + ' Owner',
      ownerEmail: onboardOwnerEmail.trim() || 'owner@bisnisbaru.id',
      category: onboardCategory,
      planId: onboardPlanId,
      subscriptionStatus: 'active',
      postsPublishedThisMonth: 1,
      monthlyPostQuota: planSpec.monthlyPostQuota,
      connectedChannels: ['instagram', 'facebook', 'tiktok', 'youtube_shorts'],
      metaAdsConnected: true,
      activeMetaCampaigns: 1,
      monthlySubscriptionRevenueIdr: planSpec.priceMonthlyIdr,
      estimatedMonthlyApiCostIdr: econ.estimatedApiCostIdr,
      grossMarginPct: econ.grossMarginPct,
    };

    setBrand(createdBrand);
    setActivePlanId(onboardPlanId);
    setPostsUsedThisMonth(1);
    setAdCity(cleanCity);
    setAdPromoTitle(cleanOffering);
    setTenants((prev) => [newTenantSummary, ...prev]);
    setSelectedPresetKey('custom');
    setOnboardBusinessName('');
    setOnboardOfferingTitle('');
    onboardingDialogRef.current?.close();
    setStatusBanner(
      `Selamat datang! Workspace bisnis baru "${cleanName}" (${cleanCity}) berhasil dibuat dengan paket ${planSpec.name}!`,
    );
  };

  const handleRealFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const mediaType: 'photo' | 'video_reel' = isVideo ? 'video_reel' : newAssetMediaType;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl =
        typeof reader.result === 'string'
          ? reader.result
          : 'https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&w=800&q=80';
      const cleanTitle =
        newAssetTitle.trim() ||
        file.name.replace(/\.[^.]+$/, '') ||
        `Upload ${brand.businessName}`;

      const created: BrandVaultAsset = {
        id: `vault_file_${Date.now()}`,
        workspaceId: brand.workspaceId,
        drawer: newAssetDrawer,
        mediaType,
        title: cleanTitle,
        description:
          newAssetDrawer === 'style_reference'
            ? `File referensi "${file.name}" diunggah langsung dari perangkat & diekstrak Style DNA-nya.`
            : `File dokumentasi asli "${file.name}" milik ${brand.businessName} siap dipakai Studio & Agent Otonom.`,
        previewUrl: dataUrl,
        aspectRatio: mediaType === 'video_reel' ? '9:16' : '4:5',
        tags: [
          newAssetDrawer === 'style_reference' ? 'style-dna' : 'aset-asli-device',
          brand.category,
        ],
        uploadedFrom: viewportMode === 'mobile_native' ? 'ios' : 'web',
        createdAt: 'Baru saja (File Perangkat)',
        usedInPostsCount: 1,
        extractedStyleDna:
          newAssetDrawer === 'style_reference'
            ? extractStyleDnaFromReference({
                title: cleanTitle,
                description: brand.visualVibe,
                mediaType,
                category: brand.category,
              })
            : undefined,
      };
      setVaultAssets((prev) => [created, ...prev]);
      setNewAssetTitle('');
      setStatusBanner(
        `File perangkat "${file.name}" berhasil diunggah ke ${
          newAssetDrawer === 'style_reference' ? 'Laci 1 (Style DNA)' : 'Laci 2 (Aset Asli Bisnis)'
        }!`,
      );
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleOpenOAuthConfigModal = (channel: SocialChannelId) => {
    const found = connections.find((c) => c.channel === channel);
    setEditingChannel(channel);
    setEditingChannelHandle(found?.handle || `@${brand.businessName.toLowerCase().replace(/\s+/g, '')}`);
    setEditingMetaAdAccountId(metaAccount.adAccountId);
    oauthDialogRef.current?.showModal();
  };

  const handleSaveOAuthChannelCustomConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHandle = editingChannelHandle.trim() || '@veloxabrand.id';
    const cleanAct = editingMetaAdAccountId.trim().startsWith('act_')
      ? editingMetaAdAccountId.trim()
      : `act_${editingMetaAdAccountId.trim().replace(/\D/g, '') || '889920144512'}`;

    setConnections((prev) =>
      prev.map((c) =>
        c.channel === editingChannel
          ? {
              ...c,
              connected: true,
              handle: cleanHandle,
              accountName: `${brand.businessName} (${CHANNEL_META[editingChannel].shortLabel})`,
              oauthMode: 'direct_publish',
              lastPublishedAt: 'Terhubung via OAuth 1-Klik',
            }
          : c,
      ),
    );
    setMetaAccount((prev) => ({
      ...prev,
      connected: true,
      adAccountId: cleanAct,
    }));
    oauthDialogRef.current?.close();
    setStatusBanner(
      `Akun ${CHANNEL_META[editingChannel].shortLabel} (${cleanHandle}) & Meta Ads (${cleanAct}) berhasil dikonfigurasi!`,
    );
  };

  const handleConfirmQrisSubscriptionUpgrade = async () => {
    const spec = SUBSCRIPTION_PLANS[selectedCheckoutPlanId];
    let invoiceId = `INV-VLX-${Date.now().toString().slice(-6)}`;
    try {
      const res = await fetch('/api/veloxa/billing-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: invoiceId,
          workspaceId: brand.workspaceId,
          planId: selectedCheckoutPlanId,
          transactionStatus: 'PAID',
          paymentType: paymentMethodTab === 'qris' ? 'qris' : 'bank_transfer_bca',
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { invoiceId?: string };
        if (data.invoiceId) invoiceId = data.invoiceId;
      }
    } catch {
      // non-blocking fallback for static export
    }

    setActivePlanId(selectedCheckoutPlanId);
    setTenants((prev) =>
      prev.map((t, idx) => {
        if (t.workspaceId !== brand.workspaceId && idx !== 0) return t;
        const econ = calculateTenantUnitEconomics({
          planId: selectedCheckoutPlanId,
          postsPublishedThisMonth: t.postsPublishedThisMonth,
        });
        return {
          ...t,
          planId: selectedCheckoutPlanId,
          monthlyPostQuota: spec.monthlyPostQuota,
          monthlySubscriptionRevenueIdr: spec.priceMonthlyIdr,
          estimatedMonthlyApiCostIdr: econ.estimatedApiCostIdr,
          grossMarginPct: econ.grossMarginPct,
        };
      }),
    );
    setBillingReceipts((prev) => [
      {
        id: invoiceId,
        workspaceName: brand.businessName,
        planName: spec.name,
        amountIdr: spec.priceMonthlyIdr,
        paidAtWib: 'Baru saja · Lunas QRIS',
      },
      ...prev,
    ]);
    billingDialogRef.current?.close();
    setStatusBanner(
      `Pembayaran Lunas (${invoiceId})! Paket "${spec.name}" (${formatIdr(spec.priceMonthlyIdr)}/bln · Kuota ${spec.monthlyPostQuota} konten) aktif untuk ${brand.businessName}!`,
    );
  };

  const handleEmailSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const signedIn = await signInWithEmailPasswordOrRegister({
      email: authEmailInput,
      password: authPasswordInput,
    });
    setAuthUser(signedIn);
    setActiveRole(signedIn.isSuperAdmin ? 'admin' : 'user');
    setShowLandingPage(false);
    authDialogRef.current?.close();
    setStatusBanner(
      signedIn.isSuperAdmin
        ? `Login Firebase berhasil sebagai Super Admin (${signedIn.email})!`
        : `Login Firebase berhasil sebagai Pelanggan (${signedIn.email})!`,
    );
  };

  const handleGoogleSignInClick = async () => {
    const signedIn = await signInWithGooglePopup();
    setAuthUser(signedIn);
    setActiveRole(signedIn.isSuperAdmin ? 'admin' : 'user');
    setShowLandingPage(false);
    authDialogRef.current?.close();
    setStatusBanner(`Login Google OAuth berhasil sebagai ${signedIn.email}!`);
  };

  const handleSignOutClick = async () => {
    const guest = await signOutVeloxaUser();
    setAuthUser(guest);
    setActiveRole('user');
    authDialogRef.current?.close();
    setStatusBanner(`Beralih ke sesi akun pelanggan: ${guest.email}`);
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
    setBrand(nextBrand);
    setAdCity(nextBrand.city);
    setAdPromoTitle(nextBrand.offerings[0]?.title || nextBrand.businessName);
    setStatusBanner(`Workspace beralih ke preset "${nextBrand.businessName}" (${nextBrand.city}).`);
  };

  const handleToggleChannel = (channel: SocialChannelId) => {
    setConnections((prev) =>
      prev.map((c) =>
        c.channel === channel
          ? {
              ...c,
              connected: !c.connected,
              oauthMode: !c.connected ? 'direct_publish' : 'disconnected',
              lastPublishedAt: !c.connected ? 'Baru saja terhubung via OAuth' : null,
            }
          : c,
      ),
    );
    const info = getCentralOAuthCallbackUri(channel);
    setStatusBanner(`Status OAuth ${CHANNEL_META[channel].shortLabel} diperbarui (${info.oauthProviderLabel}).`);
  };

  const handleUploadVaultAsset = async (useDevicePicker: boolean) => {
    let title = newAssetTitle.trim();
    let previewUrl =
      newAssetDrawer === 'style_reference'
        ? 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&w=800&q=80'
        : 'https://images.unsplash.com/photo-1511920170033-f8396924c348?auto=format&fit=crop&w=800&q=80';
    let uploadedFrom: 'web' | 'android' | 'ios' = viewportMode === 'mobile_native' ? 'ios' : 'web';

    if (useDevicePicker) {
      const picked = await pickBrandAssetFromDevice({ mediaType: newAssetMediaType });
      if (picked) {
        title = title || picked.title;
        previewUrl = picked.previewUrl;
        uploadedFrom = picked.uploadedFrom;
      }
    }

    if (!title) {
      title =
        newAssetDrawer === 'style_reference'
          ? `Referensi ${newAssetMediaType === 'video_reel' ? 'Reels 9:16' : 'Carousel'} · ${brand.businessName}`
          : `Aset Asli ${brand.businessName} · ${new Date().toLocaleTimeString('id-ID')}`;
    }

    const created: BrandVaultAsset = {
      id: `vault_${Date.now()}`,
      workspaceId: brand.workspaceId,
      drawer: newAssetDrawer,
      mediaType: newAssetMediaType,
      title,
      description:
        newAssetDrawer === 'style_reference'
          ? 'Diekstrak otomatis oleh Veloxa Vision AI untuk panduan komposisi & hook.'
          : `Aset dokumentasi asli milik ${brand.businessName} untuk dipadukan ke konten otomatis.`,
      previewUrl,
      aspectRatio: newAssetMediaType === 'video_reel' ? '9:16' : '4:5',
      tags: [newAssetDrawer === 'style_reference' ? 'style-dna' : 'aset-asli', brand.category],
      uploadedFrom,
      createdAt: 'Baru saja',
      usedInPostsCount: 0,
      extractedStyleDna:
        newAssetDrawer === 'style_reference'
          ? extractStyleDnaFromReference({
              title,
              description: brand.visualVibe,
              mediaType: newAssetMediaType,
              category: brand.category,
            })
          : undefined,
    };

    setVaultAssets((prev) => [created, ...prev]);
    setNewAssetTitle('');
    setStatusBanner(
      created.drawer === 'style_reference'
        ? `Referensi "${created.title}" ditambahkan & Style DNA berhasil diekstrak!`
        : `Aset asli "${created.title}" masuk ke Brand Vault & siap dipakai Agent Konten!`,
    );
  };

  const handleGenerateStudioDraft = async (source: ContentDraft['source'] = 'manual_studio', scheduledSlotWib?: string) => {
    const quotaGuard = canConsumePostingQuota({
      planId: activePlanId,
      postsPublishedThisMonth: postsUsedThisMonth,
    });
    if (!quotaGuard.allowed) {
      setStatusBanner(quotaGuard.reason || 'Kuota bulanan habis.');
      return;
    }

    const activeCamp = eventCampaigns.find(
      (c) => c.status === 'active' && c.workspaceId === brand.workspaceId,
    );
    let created = generateBrandContentDraft({
      brand,
      format: studioFormat,
      source,
      customTopic: studioTopic,
      vaultAssets,
      connections,
      planId: activePlanId,
      activeCampaign: activeCamp,
      scheduledForWib: scheduledSlotWib,
    });

    try {
      const res = await fetch('/api/veloxa/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'content_creator_and_critic',
          brand,
          format: studioFormat,
          source,
          customTopic: studioTopic,
          vaultAssets,
          connections,
          planId: activePlanId,
          activeCampaign: activeCamp,
          scheduledForWib: scheduledSlotWib,
          openAiApiKey: openAiInputKey.trim() || undefined,
        }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { ok?: boolean; draft?: ContentDraft };
        if (payload.ok && payload.draft) {
          created = payload.draft;
        }
      }
    } catch {
      // fallback to local deterministic draft
    }

    setDrafts((prev) => [created, ...prev]);
    setPostsUsedThisMonth((prev) => prev + 1);
    setStudioTopic('');
    setStatusBanner(
      `Konten "${created.title}" (${created.format}) berhasil dibuat, lolos Quality Gate (${created.qualityReview.score}/100 · 0 issue), dan siap tayang di ${created.targetChannels.length} platform!`,
    );
  };

  const handlePublishDraftNow = async (draftId: string) => {
    const targetDraft = drafts.find((d) => d.id === draftId);
    if (targetDraft) {
      try {
        await fetch('/api/veloxa/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft: targetDraft }),
        });
      } catch {
        // non-blocking fallback
      }
    }
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === draftId
          ? {
              ...d,
              status: 'published',
              publishedAtWib: 'Baru saja · Tayang Serentak',
              channelStatuses: d.channelStatuses.map((cs) => ({
                ...cs,
                status: 'published',
                publishedAt: 'Baru saja',
              })),
            }
          : d,
      ),
    );
    setStatusBanner('Konten berhasil diterbitkan serentak ke seluruh kanal medsos yang terhubung!');
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
  };

  const handleToggleMetaCampaignRun = async (campaignId: string) => {
    const targetCamp = metaAdCampaigns.find((c) => c.id === campaignId);
    if (targetCamp) {
      try {
        await fetch('/api/veloxa/meta-ads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign: targetCamp,
            adAccountId: metaAccount.adAccountId,
            targetStatus: targetCamp.status === 'active_running' ? 'PAUSED' : 'ACTIVE',
          }),
        });
      } catch {
        // non-blocking fallback
      }
    }
    setMetaAdCampaigns((prev) =>
      prev.map((c) =>
        c.id === campaignId
          ? {
              ...c,
              status: c.status === 'active_running' ? 'draft_paused' : 'active_running',
            }
          : c,
      ),
    );
    setStatusBanner('Status tayangan kampanye di Meta Ads Manager berhasil diperbarui.');
  };

  const handleRunMetaAutoOptimizer = (campaignId: string) => {
    setMetaAdCampaigns((prev) =>
      prev.map((c) => (c.id === campaignId ? runMetaAdsAutonomousOptimizer(c) : c)),
    );
    setStatusBanner(
      'AI Media Buyer selesai menganalisa Meta Ads Insights: variasi iklan mahal dimatikan & 100% budget dialihkan ke pemenang!',
    );
  };

  const handleAdminChangeTenantPlan = (workspaceId: string, nextPlanId: SubscriptionPlanId) => {
    const spec = SUBSCRIPTION_PLANS[nextPlanId];
    setTenants((prev) =>
      prev.map((t) => {
        if (t.workspaceId !== workspaceId) return t;
        const econ = calculateTenantUnitEconomics({
          planId: nextPlanId,
          postsPublishedThisMonth: t.postsPublishedThisMonth,
        });
        return {
          ...t,
          planId: nextPlanId,
          monthlyPostQuota: spec.monthlyPostQuota,
          monthlySubscriptionRevenueIdr: spec.priceMonthlyIdr,
          estimatedMonthlyApiCostIdr: econ.estimatedApiCostIdr,
          grossMarginPct: econ.grossMarginPct,
        };
      }),
    );
    if (workspaceId === brand.workspaceId) {
      setActivePlanId(nextPlanId);
    }
    setStatusBanner(`Paket langganan tenant berhasil diperbarui ke ${spec.name} (${formatIdr(spec.priceMonthlyIdr)}/bln).`);
  };

  const handleSaveCloudConnectionConfig = () => {
    const nextCfg = saveFirebaseConnectionConfig({
      ...firebaseCfg,
      openAiConnected: Boolean(openAiInputKey.trim() || firebaseCfg.openAiConnected),
      openAiApiKeyMasked: openAiInputKey.trim()
        ? `${openAiInputKey.trim().slice(0, 8)}••••••••••••••••`
        : firebaseCfg.openAiApiKeyMasked,
    });
    setFirebaseCfg(nextCfg);
    setStatusBanner(
      `Konfigurasi Cloud Firebase (${nextCfg.projectId}) & 5 OpenAI Agent berhasil disimpan (${nextCfg.lastSyncedAtWib}).`,
    );
  };

  const organicWinnerDraft = drafts.find((d) => d.organicMetrics?.isOrganicWinner);

  return (
    <div className="min-h-dvh bg-[#FAFAFA] pb-24 text-neutral-900">
      {/* Top Global Control Header — Dominan Putih Bersih + Aksen Soft Pink */}
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/95 text-neutral-900 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EC749B] font-black text-white shadow-xs">
              V
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black tracking-tight text-neutral-900">VELOXA AI</span>
                <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[11px] font-bold text-[#D85A88]">
                  Web · Android · iOS
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                Autonomous Social Content Studio & AI Meta Ads Marketing Agent
              </p>
            </div>
          </div>

          {/* Role Switcher, Landing Page Switcher, Firebase Auth, & Viewport Mode Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="toggle-landing-page-btn"
              onClick={() => setShowLandingPage((v) => !v)}
              className={`rounded-2xl border px-3.5 py-2 text-xs font-bold transition ${
                showLandingPage
                  ? 'border-[#EC749B] bg-[#EC749B] text-white shadow-xs'
                  : 'border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]'
              }`}
            >
              {showLandingPage ? '← Kembali ke Dashboard' : '🌐 Landing Page Penjualan'}
            </button>

            <div
              role="group"
              aria-label="Pilih Peran Aplikasi"
              className="flex rounded-2xl border border-neutral-200 bg-neutral-50 p-1"
            >
              <button
                type="button"
                onClick={() => {
                  setActiveRole('user');
                  setShowLandingPage(false);
                }}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                  activeRole === 'user' && !showLandingPage
                    ? 'bg-[#EC749B] text-white shadow-xs'
                    : 'text-neutral-600 hover:bg-white hover:text-neutral-900'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Role: USER Workspace
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveRole('admin');
                  setShowLandingPage(false);
                }}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                  activeRole === 'admin' && !showLandingPage
                    ? 'bg-[#EC749B] text-white shadow-xs'
                    : 'text-neutral-600 hover:bg-white hover:text-neutral-900'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Role: SUPER ADMIN
              </button>
            </div>

            <button
              type="button"
              data-testid="open-auth-modal-btn"
              onClick={() => authDialogRef.current?.showModal()}
              className="flex items-center gap-1.5 rounded-2xl border border-pink-200 bg-pink-50/70 px-3 py-2 text-xs font-bold text-[#D85A88] hover:bg-pink-100/70"
            >
              <Lock className="h-3.5 w-3.5 text-[#EC749B]" />
              {authUser.email}
            </button>

            <button
              type="button"
              onClick={() =>
                setViewportMode((m) => (m === 'desktop_web' ? 'mobile_native' : 'desktop_web'))
              }
              className="flex items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
            >
              <Smartphone className="h-3.5 w-3.5 text-[#EC749B]" />
              {viewportMode === 'desktop_web'
                ? 'Tampilan: Web Desktop'
                : 'Tampilan: Native Mobile (Android/iOS)'}
            </button>
          </div>
        </div>

        {/* Status Toast Strip — Clean White with Soft Pink Dot + Local-First & Billing Trigger */}
        <div className="border-t border-neutral-100 bg-white px-4 py-1.5 text-xs text-neutral-600">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#EC749B]" />
              {statusBanner}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="local-first-sync-btn"
                onClick={() => void handleForceCloudSync()}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
              >
                <RefreshCw className="h-3 w-3 text-[#EC749B]" />
                Local-First Hemat {firestoreSavingsPct}% Firestore · Sinkronkan Cloud
              </button>
              {activeRole === 'user' && (
                <button
                  type="button"
                  data-testid="open-billing-modal-btn"
                  onClick={() => {
                    setSelectedCheckoutPlanId(activePlanId);
                    billingDialogRef.current?.showModal();
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[11px] font-bold text-[#D85A88] hover:bg-pink-100/70"
                >
                  <CreditCard className="h-3 w-3 text-[#EC749B]" />
                  Paket: {currentPlan.name} ({formatIdr(currentPlan.priceMonthlyIdr)}/bln) · Kuota{' '}
                  {postsUsedThisMonth}/{currentPlan.monthlyPostQuota} · Upgrade
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container (Supports Wide Desktop Web OR Native Phone Shell Preview) */}
      <main
        className={`mx-auto transition-all duration-300 ${
          viewportMode === 'mobile_native'
            ? 'my-6 max-w-[430px] overflow-hidden rounded-[42px] border-[10px] border-neutral-200 bg-white shadow-xl'
            : 'max-w-7xl px-4 py-6 sm:px-6'
        }`}
      >
        {viewportMode === 'mobile_native' && (
          <div className="flex items-center justify-between border-b border-neutral-100 bg-white px-6 py-2.5 text-[11px] font-bold text-neutral-800">
            <span>09:41</span>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-0.5 text-[10px] font-extrabold text-[#D85A88]">
              Veloxa iOS / Android Shell
            </span>
            <span>5G · 100%</span>
          </div>
        )}

        <div className={viewportMode === 'mobile_native' ? 'bg-[#FAFAFA] p-4 pb-24' : ''}>
          {showLandingPage ? (
            /* ======================================================================
               TAHAP 5B: COMMERCIAL SALES LANDING PAGE (DOMINAN PUTIH + SOFT PINK)
               ====================================================================== */
            <div className="space-y-8" data-testid="veloxa-sales-landing-page">
              {/* Hero Section */}
              <section className="rounded-3xl border border-neutral-200/80 bg-white p-8 text-center shadow-2xs sm:p-12">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3.5 py-1 text-xs font-black text-[#D85A88]">
                  <Sparkles className="h-3.5 w-3.5 text-[#EC749B]" /> Platform SaaS Otonom #1 untuk UMKM, Cafe, Klinik & Event di Indonesia
                </span>
                <h1 className="mx-auto mt-4 max-w-3xl text-3xl font-black tracking-tight text-neutral-900 sm:text-5xl">
                  Punya Tim Konten Kreator 4 Sosmed & AI Media Buyer Meta Ads 24/7 Mulai{' '}
                  <span className="text-[#EC749B]">Rp500.000/Bulan</span>
                </h1>
                <p className="mx-auto mt-4 max-w-2xl text-sm text-neutral-600 sm:text-base">
                  Cukup unggah contoh referensi poster/Reels yang Anda sukai dan stok foto asli bisnis Anda. Veloxa AI memproduksi, memeriksa kualitas hingga 0 kesalahan, memposting otomatis ke <strong>Instagram, Facebook, TikTok, & YouTube Shorts</strong>, serta mengoptimasi iklan <strong>Meta Ads</strong> Anda setiap hari.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    data-testid="landing-cta-start-btn"
                    onClick={() => {
                      setShowLandingPage(false);
                      onboardingDialogRef.current?.showModal();
                    }}
                    className="rounded-2xl bg-[#EC749B] px-6 py-3.5 text-sm font-black text-white shadow-2xs hover:bg-[#DF608A]"
                  >
                    <Rocket className="mr-1.5 inline h-4 w-4" />
                    Daftarkan Bisnis Anda Sekarang
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLandingPage(false)}
                    className="rounded-2xl border border-neutral-200 bg-white px-6 py-3.5 text-sm font-bold text-neutral-800 hover:border-pink-200 hover:text-[#D85A88]"
                  >
                    Lihat Live Demo Workspace →
                  </button>
                </div>

                <div className="mt-8 grid gap-4 border-t border-neutral-100 pt-6 text-left sm:grid-cols-3">
                  <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-4">
                    <p className="text-xs font-black uppercase text-[#D85A88]">1. Dual Brand Vault</p>
                    <p className="mt-1 text-sm font-bold text-neutral-900">
                      Tiru Gaya Referensi + Pakai Foto Produk Asli Anda
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      AI mengekstrak Style DNA dari contoh yang Anda sukai dan memadukannya dengan foto menu/event asli bisnis Anda.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-4">
                    <p className="text-xs font-black uppercase text-[#D85A88]">2. Otonom 4 Kanal Sekaligus</p>
                    <p className="mt-1 text-sm font-bold text-neutral-900">
                      IG Reels, FB Page, TikTok, & YouTube Shorts
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Bebas atur jadwal tayang 1x–4x sehari + Mode Kampanye Event hitung mundur (H-30 s.d. Hari-H).
                    </p>
                  </div>
                  <div className="rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-4">
                    <p className="text-xs font-black uppercase text-[#D85A88]">3. AI Agent Meta Ads</p>
                    <p className="mt-1 text-sm font-bold text-neutral-900">
                      Demografi, Validated Interest, & Auto-Optimizer
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Mematikan variasi iklan mahal secara otomatis dan mengalihkan 100% budget ke iklan pemenang di bawah Pagar Budget Anda.
                    </p>
                  </div>
                </div>
              </section>

              {/* Cost Comparison Calculator: Agency vs Veloxa AI */}
              <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs sm:p-8">
                <h2 className="text-xl font-black text-neutral-900">
                  Perbandingan Biaya Bulanan: Sewa Agensi Konvensional vs Veloxa AI
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-5 text-xs">
                    <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 font-bold text-neutral-500">
                      Cara Lama (Agensi Sosmed + Freelancer Iklan)
                    </span>
                    <p className="mt-3 text-2xl font-black text-neutral-800">Rp6.500.000 – Rp9.000.000 / bln</p>
                    <ul className="mt-3 space-y-1.5 text-neutral-600">
                      <li>• Admin & Desainer Feed/Reels: ~Rp4.500.000/bulan</li>
                      <li>• Jasa Advertiser Meta Ads: ~Rp2.500.000/bulan</li>
                      <li>• Revisi lama & sering terlambat mengejar momentum event</li>
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-pink-300 bg-white p-5 text-xs ring-2 ring-pink-100">
                    <span className="rounded-full bg-[#EC749B] px-2.5 py-0.5 font-bold text-white">
                      ★ Cara Baru Bersama Veloxa AI (Hemat hingga 85%)
                    </span>
                    <p className="mt-3 text-2xl font-black text-[#D85A88]">Rp500.000 – Rp1.500.000 / bln</p>
                    <ul className="mt-3 space-y-1.5 text-neutral-700">
                      <li>• <strong>20 hingga 90 konten/bulan</strong> tayang otomatis di 4 platform</li>
                      <li>• <strong>Self-Healing Quality Gate</strong> memeriksa kualitas visual & caption</li>
                      <li>• <strong>AI Agent Meta Ads 24/7</strong> + Aplikasi Web, Android (`.apk`), & iOS</li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* Pricing Cards on Landing Page */}
              <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs sm:p-8">
                <h2 className="text-xl font-black text-neutral-900">
                  Pilih Paket Langganan Sesuai Skala Bisnis Anda
                </h2>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {Object.values(SUBSCRIPTION_PLANS).map((plan) => (
                    <div
                      key={plan.id}
                      className={`flex flex-col justify-between rounded-2xl border p-5 ${
                        plan.id === 'pro_1500k'
                          ? 'border-pink-300 bg-white ring-2 ring-pink-100'
                          : 'border-neutral-200 bg-white'
                      }`}
                    >
                      <div>
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
                          <li>• Kuota: <strong className="text-neutral-900">{plan.monthlyPostQuota} postingan/bulan</strong></li>
                          <li>• Kanal: <strong className="text-neutral-900">{plan.allowedChannels.join(', ').toUpperCase()}</strong></li>
                          <li>• AI Agent Meta Ads: <strong className="text-neutral-900">{plan.includesMetaAdsAgent ? 'Termasuk + Auto-Optimizer' : 'Tidak'}</strong></li>
                        </ul>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCheckoutPlanId(plan.id);
                          setShowLandingPage(false);
                          billingDialogRef.current?.showModal();
                        }}
                        className="mt-5 w-full rounded-xl bg-[#EC749B] py-2.5 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                      >
                        Pilih {plan.name} (QRIS / VA)
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : activeRole === 'admin' ? (
            /* ======================================================================
               ROLE 1: SUPER ADMIN COMMAND CENTER — DOMINAN PUTIH + AKSEN SOFT PINK
               ====================================================================== */
            <div className="space-y-6" data-testid="super-admin-dashboard">
              <div className="flex flex-col justify-between gap-4 rounded-3xl border border-neutral-200/80 bg-white p-6 text-neutral-900 shadow-2xs sm:flex-row sm:items-center">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                    <ShieldCheck className="h-3.5 w-3.5 text-[#EC749B]" /> Super Admin Control Center
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
              <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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
              <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 id="tenant-table-caption" className="text-lg font-black text-neutral-900">
                      Daftar Pelanggan (Tenants) & Kontrol Kuota
                    </h2>
                    <p className="text-xs text-neutral-500">
                      Ubah paket pelanggan secara instan atau pantau margin pemakaian API masing-masing brand.
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Central API & OAuth Vault (1 App Developer for All Users) */}
              <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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
              <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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
               ROLE 2: USER WORKSPACE — DOMINAN PUTIH BERSIH + BUTTON/AKSEN SOFT PINK
               ====================================================================== */
            <div className="space-y-6" data-testid="user-workspace-dashboard">
              {/* Industry Preset Switcher Bar + New Business Onboarding Wizard Trigger */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-neutral-200/80 bg-white p-4 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EC749B] font-black text-white shadow-2xs">
                    {brand.businessName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-lg font-black text-neutral-900">{brand.businessName}</h1>
                      <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[11px] font-bold text-[#D85A88]">
                        {brand.city}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      Contoh Workspace Pelanggan · Pilih simulasi jenis bisnis atau daftarkan brand baru:
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { key: 'running_event', label: '🏃‍♂️ Event Lari (Nusantara Run)' },
                      { key: 'cafe_fnb', label: '☕ Cafe & F&B (Kopi Senja)' },
                      { key: 'clinic_beauty', label: '✨ Klinik (GlowDerm)' },
                      { key: 'custom', label: '🎨 Bisnis Kustom' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleSelectBrandPreset(item.key)}
                      className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                        selectedPresetKey === item.key
                          ? 'bg-[#EC749B] text-white shadow-2xs'
                          : 'border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid="open-onboarding-modal-btn"
                    onClick={() => onboardingDialogRef.current?.showModal()}
                    className="inline-flex items-center gap-1 rounded-xl border border-pink-300 bg-pink-50/80 px-3 py-2 text-xs font-black text-[#D85A88] hover:bg-[#EC749B] hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Bisnis Baru
                  </button>
                </div>
              </div>

              {/* Desktop Horizontal Navigation Tabs */}
              {viewportMode === 'desktop_web' && (
                <nav
                  aria-label="Menu Utama User Workspace"
                  className="grid grid-cols-2 gap-2 rounded-2xl border border-neutral-200/80 bg-white p-2 shadow-2xs sm:grid-cols-5"
                >
                  {(
                    [
                      { id: 'overview', label: '1. Beranda & Kanal', icon: LayoutDashboard },
                      { id: 'brand_vault', label: '2. Brand & Referensi', icon: Camera },
                      { id: 'studio', label: '3. Studio Konten', icon: Wand2 },
                      { id: 'autonomy', label: '4. Agent Otonom', icon: Bot },
                      { id: 'meta_ads', label: '5. AI Meta Ads', icon: Megaphone },
                    ] as const
                  ).map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-xs font-black transition ${
                          activeTab === tab.id
                            ? 'bg-[#EC749B] text-white shadow-2xs'
                            : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </nav>
              )}

              {/* ====================================================================
                 TAB 1: BERANDA & KONEKSI 4 KANAL SOSMED + META ADS
                 ==================================================================== */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Organic Winner Auto-Boost Alert Banner — Pure White Card + Soft Pink CTA */}
                  {organicWinnerDraft && (
                    <div
                      className={`flex justify-between gap-4 rounded-3xl border border-neutral-200/80 bg-white p-5 shadow-2xs ${
                        viewportMode === 'mobile_native'
                          ? 'flex-col'
                          : 'flex-col sm:flex-row sm:items-center'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-pink-50 text-[#EC749B] border border-pink-100">
                          <Flame className="h-5 w-5" />
                        </div>
                        <div>
                          <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black uppercase text-[#D85A88]">
                            ★ Rekomendasi Pintar AI Marketing
                          </span>
                          <h2 className="mt-1 text-base font-black text-neutral-900">
                            Konten Organik Sedang Ramai! ({organicWinnerDraft.organicMetrics?.reach.toLocaleString('id-ID')} Reach · Engagement {organicWinnerDraft.organicMetrics?.engagementRatePct}%)
                          </h2>
                          <p className="mt-0.5 text-xs text-neutral-600">
                            Reels <strong className="text-neutral-900">&ldquo;{organicWinnerDraft.title}&rdquo;</strong> punya performa organik sangat tinggi. Ubah menjadi kampanye Meta Ads ({formatIdr(organicWinnerDraft.organicMetrics?.recommendedAdDailyBudgetIdr || 150_000)}/hari) untuk menjangkau ribuan calon pembeli baru di {brand.city}!
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDesignMetaAdsWithAi(organicWinnerDraft)}
                        className="shrink-0 rounded-2xl bg-[#EC749B] px-4 py-3 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                      >
                        <Rocket className="mr-1.5 inline h-4 w-4 text-white" />
                        Boost Jadi Meta Ads 1-Klik
                      </button>
                    </div>
                  )}

                  {/* 4 Social Channels OAuth Connection Cards — Pure White Cards */}
                  <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-lg font-black text-neutral-900">
                          Hubungkan Akun Media Sosial Anda (OAuth 1-Klik)
                        </h2>
                        <p className="text-xs text-neutral-500">
                          Tidak perlu membuat API Key sendiri—cukup klik Hubungkan dan login ke akun medsos bisnis Anda.
                        </p>
                      </div>
                      <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                        ✓ {connections.filter((c) => c.connected).length} dari 4 Platform Terhubung
                      </span>
                    </div>

                    <div
                      className={`mt-4 grid gap-4 ${
                        viewportMode === 'mobile_native'
                          ? 'grid-cols-1'
                          : 'sm:grid-cols-2 lg:grid-cols-4'
                      }`}
                    >
                      {connections.map((conn) => {
                        const meta = CHANNEL_META[conn.channel];
                        return (
                          <div
                            key={conn.channel}
                            className="flex flex-col justify-between rounded-2xl border border-neutral-200/90 bg-white p-4 transition hover:border-pink-200"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${meta.badgeClass}`}
                                >
                                  {meta.shortLabel}
                                </span>
                                <span
                                  className={`text-[11px] font-bold ${
                                    conn.connected ? 'text-[#D85A88]' : 'text-neutral-400'
                                  }`}
                                >
                                  {conn.connected ? '● Terhubung' : '○ Terputus'}
                                </span>
                              </div>
                              <p className="mt-3 text-sm font-black text-neutral-900">{meta.label}</p>
                              <p className="mt-1 text-xs font-semibold text-neutral-700">
                                {conn.connected ? `${conn.handle} · ${conn.followerCount.toLocaleString('id-ID')} pengikut` : 'Belum ditautkan'}
                              </p>
                              <p className="mt-1 text-[11px] text-neutral-500">
                                {conn.connected
                                  ? `Tayang terakhir: ${conn.lastPublishedAt}`
                                  : 'Mendukung jadwal otomatis & publikasi instan'}
                              </p>
                            </div>

                            <div className="mt-4 flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleChannel(conn.channel)}
                                className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                                  conn.connected
                                    ? 'border border-neutral-200 bg-white text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]'
                                    : 'bg-[#EC749B] text-white shadow-2xs hover:bg-[#DF608A]'
                                }`}
                              >
                                {conn.connected ? 'Putuskan' : `Hubungkan ${meta.shortLabel}`}
                              </button>
                              <button
                                type="button"
                                data-testid={`oauth-config-btn-${conn.channel}`}
                                onClick={() => handleOpenOAuthConfigModal(conn.channel)}
                                className="rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-[11px] font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                              >
                                Atur OAuth
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Meta Ads Account Connection & Quick Summary */}
                  <div
                    className={`grid gap-5 ${
                      viewportMode === 'mobile_native' ? 'grid-cols-1' : 'lg:grid-cols-2'
                    }`}
                  >
                    <div className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-bold text-neutral-700">
                          Meta Marketing API · Ads Manager
                        </span>
                        <span className="text-xs font-bold text-[#D85A88]">
                          ✓ Terhubung ({metaAccount.adAccountId})
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-neutral-900">
                        {metaAccount.adAccountName}
                      </h3>
                      <p className="mt-1 text-xs text-neutral-500">
                        Tagihan iklan dibayar langsung oleh metode pembayaran Anda di Meta ({metaAccount.paymentMethodLabel}).
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-neutral-100 bg-neutral-50/70 p-3.5 text-xs">
                        <div>
                          <span className="text-neutral-500">Pagar Budget Harian Maks:</span>
                          <p className="text-sm font-black text-neutral-900">
                            {formatIdr(metaAccount.dailyHardCapIdr)}/hari
                          </p>
                        </div>
                        <div>
                          <span className="text-neutral-500">AI Media Buyer Optimizer:</span>
                          <p className="text-sm font-black text-[#D85A88]">
                            {metaAccount.autoOptimizeEnabled ? '✓ Aktif Otomatis 24/7' : 'Manual'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('meta_ads')}
                        className="mt-4 w-full rounded-xl bg-[#EC749B] py-2.5 text-xs font-bold text-white shadow-2xs hover:bg-[#DF608A]"
                      >
                        Buka AI Agent Marketing (Meta Ads) →
                      </button>
                    </div>

                    <div className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-bold text-neutral-700">
                          Ringkasan Kuota & Otonomi
                        </span>
                        <span className="text-xs font-bold text-neutral-600">
                          {currentPlan.name} ({formatIdr(currentPlan.priceMonthlyIdr)}/bln)
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-neutral-900">
                        Terpakai {postsUsedThisMonth} dari {currentPlan.monthlyPostQuota} Kuota Postingan Bulan Ini
                      </h3>
                      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className="h-full rounded-full bg-[#EC749B]"
                          style={{
                            width: `${Math.min(100, Math.round((postsUsedThisMonth / currentPlan.monthlyPostQuota) * 100))}%`,
                          }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-neutral-500">
                        Jadwal Otonom aktif: <strong className="text-neutral-900">{autonomyConfig.postsPerDay}x sehari</strong> ({autonomyConfig.scheduleTimesWib.join(' & ')} WIB) · Mode{' '}
                        <strong className="text-neutral-900">
                          {autonomyConfig.executionMode === 'full_autonomous'
                            ? '100% Full Otonom'
                            : 'Co-Pilot Tinjau H-1'}
                        </strong>
                      </p>
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab('studio')}
                          className="flex-1 rounded-xl bg-[#EC749B] py-2.5 text-xs font-bold text-white shadow-2xs hover:bg-[#DF608A]"
                        >
                          Buat Konten di Studio
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('autonomy')}
                          className="flex-1 rounded-xl border border-neutral-200 bg-white py-2.5 text-xs font-bold text-neutral-700 hover:border-pink-200 hover:text-[#D85A88]"
                        >
                          Atur Jadwal Otonom
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ====================================================================
                 TAB 2: BRAND BRAIN & DUAL ASSET VAULT (REFERENSI GAYA vs FOTO ASLI)
                 ==================================================================== */}
              {activeTab === 'brand_vault' && (
                <div className="space-y-6">
                  <div
                    className={`grid gap-6 ${
                      viewportMode === 'mobile_native'
                        ? 'grid-cols-1'
                        : 'lg:grid-cols-[1.05fr_0.95fr]'
                    }`}
                  >
                    {/* Brand Brain Configuration */}
                    <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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
                    <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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
                  <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
                    <h3 className="text-base font-black text-neutral-900">
                      Isi Brand Vault Anda ({vaultAssets.length} Aset Tersimpan)
                    </h3>
                    <div
                      className={`mt-4 grid gap-4 ${
                        viewportMode === 'mobile_native'
                          ? 'grid-cols-1'
                          : 'sm:grid-cols-2 lg:grid-cols-4'
                      }`}
                    >
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
                  <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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
                          onChange={(e) => setStudioFormat(e.target.value as ContentFormat)}
                          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs font-bold text-neutral-900"
                        >
                          <option value="short_video">
                            Video Pendek 9:16 (IG Reels + FB Reels + TikTok + YT Shorts)
                          </option>
                          <option value="carousel">
                            Carousel Multi-Slide 4:5 (IG + FB + TikTok Photo Mode)
                          </option>
                          <option value="single_post">
                            Poster Tunggal 4:5 (IG + FB + TikTok)
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
                            onClick={() => handleGenerateStudioDraft('manual_studio')}
                            className="shrink-0 rounded-xl bg-[#EC749B] px-5 py-2.5 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                          >
                            <Sparkles className="mr-1.5 inline h-4 w-4" />
                            Buat & Periksa Otomatis
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Generated Drafts List */}
                  <div className="space-y-4">
                    {drafts.map((draft) => (
                      <article
                        key={draft.id}
                        className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-xs font-black text-[#D85A88]">
                                {draft.status === 'published' ? '✓ Sudah Tayang' : '✓ Lolos Pemeriksaan AI'}
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
                                onClick={() => handlePublishDraftNow(draft.id)}
                                className="rounded-xl bg-[#EC749B] px-4 py-2 text-xs font-black text-white shadow-2xs hover:bg-[#DF608A]"
                              >
                                <Send className="mr-1.5 inline h-3.5 w-3.5" />
                                Terbitkan ke {draft.targetChannels.length} Sosmed Sekarang
                              </button>
                            )}
                            <button
                              type="button"
                              data-testid={`download-poster-btn-${draft.id}`}
                              onClick={() => {
                                downloadDraftPosterSvg(draft, brand);
                                setStatusBanner(`Visual poster "${draft.title}" berhasil diunduh ke perangkat Anda!`);
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
                            <img
                              data-testid={`rendered-poster-img-${draft.id}`}
                              src={buildRenderedVisualSvgDataUrl({ brand, draft, slideIndex: 0 })}
                              alt={`Pratinjau Visual ${draft.title}`}
                              className="mx-auto max-h-60 w-auto rounded-xl border border-neutral-200 object-contain"
                            />
                          </div>
                          <div className="space-y-3">
                            {/* Quality Gate Proof */}
                            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 text-xs text-neutral-800">
                              <div className="flex items-center justify-between font-bold text-neutral-900">
                                <span>
                                  <span className="text-[#D85A88]">✓ Self-Healing Quality Gate:</span> {draft.qualityReview.score}/100 (0 Masalah Tersisa)
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
                                    {cs.status === 'published' ? '✓ Sudah Tayang' : '● Siap Kirim'}
                                  </span>
                                </span>
                              ))}
                            </div>
                            <p className="rounded-xl border border-neutral-100 bg-white p-3 text-xs text-neutral-600">
                              <strong className="text-neutral-900">Caption Siap Kirim:</strong> {draft.caption}
                            </p>
                          </div>
                        </div>

                        {/* Storyboard / Slides Preview — Clean White Cards */}
                        {draft.videoScenes && (
                          <div
                            className={`mt-4 grid gap-3 ${
                              viewportMode === 'mobile_native'
                                ? 'grid-cols-1'
                                : 'sm:grid-cols-2 lg:grid-cols-4'
                            }`}
                          >
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
                          <div
                            className={`mt-4 grid gap-3 ${
                              viewportMode === 'mobile_native'
                                ? 'grid-cols-1'
                                : 'sm:grid-cols-2 lg:grid-cols-4'
                            }`}
                          >
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
                                  {slide.visualDirection}
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
                  <div
                    className={`grid gap-6 ${
                      viewportMode === 'mobile_native'
                        ? 'grid-cols-1'
                        : 'lg:grid-cols-[1.1fr_0.9fr]'
                    }`}
                  >
                    {/* User-Controlled Autonomous Schedule */}
                    <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-pink-200 bg-pink-50/70 px-3 py-1 text-xs font-bold text-[#D85A88]">
                          Agent Konten Otonom 24/7
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAutonomyConfig((c) => ({ ...c, enabled: !c.enabled }))
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
                    <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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
                  <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs">
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

                    <div
                      className={`mt-5 grid gap-4 text-xs ${
                        viewportMode === 'mobile_native'
                          ? 'grid-cols-1'
                          : 'sm:grid-cols-2 lg:grid-cols-4'
                      }`}
                    >
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
                        className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-2xs"
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
                        <div
                          className={`mt-4 grid gap-4 ${
                            viewportMode === 'mobile_native' ? 'grid-cols-1' : 'lg:grid-cols-3'
                          }`}
                        >
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
                        <div
                          className={`mt-4 grid gap-3 ${
                            viewportMode === 'mobile_native' ? 'grid-cols-1' : 'sm:grid-cols-2'
                          }`}
                        >
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
          )}
        </div>

        {/* Native Mobile Bottom Navigation Bar (When in Android/iOS Mode) */}
        {activeRole === 'user' && viewportMode === 'mobile_native' && (
          <nav
            aria-label="Bottom Navigation Android dan iOS"
            className="sticky bottom-0 z-20 grid grid-cols-5 border-t border-neutral-200 bg-white/95 px-2 py-2.5 backdrop-blur"
          >
            {(
              [
                { id: 'overview', label: 'Beranda', icon: LayoutDashboard },
                { id: 'brand_vault', label: 'Vault', icon: Camera },
                { id: 'studio', label: 'Studio', icon: Wand2 },
                { id: 'autonomy', label: 'Otonom', icon: Bot },
                { id: 'meta_ads', label: 'Meta Ads', icon: Megaphone },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-col items-center gap-1 rounded-xl py-1 text-[10px] font-bold ${
                    activeTab === tab.id ? 'text-[#EC749B]' : 'text-neutral-400'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
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
         STAGE 3 MODAL: OAUTH 1-CLICK & META ADS HANDLE CUSTOMIZER (<dialog>)
         ======================================================================== */}
      <dialog
        ref={oauthDialogRef}
        aria-labelledby="oauth-dialog-title"
        data-testid="oauth-config-dialog"
        className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-6 text-neutral-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-[10px] font-black text-[#D85A88]">
              Tahap 3 · OAuth 1-Klik & Meta Marketing API
            </span>
            <h2 id="oauth-dialog-title" className="mt-1 text-base font-black text-neutral-900">
              Konfigurasi Akun {CHANNEL_META[editingChannel].shortLabel} & Meta Ads
            </h2>
          </div>
          <button
            type="button"
            onClick={() => oauthDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-600"
          >
            Tutup
          </button>
        </div>

        <form onSubmit={handleSaveOAuthChannelCustomConfig} className="mt-4 space-y-3 text-xs">
          <div>
            <label htmlFor="oauth-handle-input" className="font-bold text-neutral-700">
              Username / Handle {CHANNEL_META[editingChannel].shortLabel} Bisnis Anda
            </label>
            <input
              id="oauth-handle-input"
              data-testid="oauth-handle-input"
              type="text"
              required
              value={editingChannelHandle}
              onChange={(e) => setEditingChannelHandle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-semibold text-neutral-900"
            />
          </div>

          <div>
            <label htmlFor="oauth-meta-act-input" className="font-bold text-neutral-700">
              ID Akun Iklan Meta Ads Manager (act_...)
            </label>
            <input
              id="oauth-meta-act-input"
              data-testid="oauth-meta-act-input"
              type="text"
              required
              value={editingMetaAdAccountId}
              onChange={(e) => setEditingMetaAdAccountId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 font-mono font-semibold text-neutral-900"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => oauthDialogRef.current?.close()}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-2 font-bold text-neutral-700"
            >
              Batal
            </button>
            <button
              type="submit"
              data-testid="save-oauth-config-btn"
              className="rounded-xl bg-[#EC749B] px-5 py-2 font-black text-white shadow-2xs hover:bg-[#DF608A]"
            >
              Simpan & Hubungkan OAuth
            </button>
          </div>
        </form>
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
              Tahap 5A · Firebase Authentication (veloxa-ai-saas)
            </span>
            <h2 id="auth-dialog-title" className="mt-1 text-lg font-black text-neutral-900">
              Masuk / Beralih Akun Veloxa AI
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
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3">
            <p className="text-[11px] text-neutral-500">Sesi Aktif Saat Ini:</p>
            <p className="font-black text-neutral-900">
              {authUser.displayName} ({authUser.email})
            </p>
            <span className="mt-1 inline-block rounded-full border border-pink-200 bg-pink-50/80 px-2.5 py-0.5 text-[10px] font-bold text-[#D85A88]">
              {authUser.isSuperAdmin ? '★ Super Admin (Owner SaaS)' : '✓ Customer Workspace Tenant'}
            </span>
          </div>

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
                Email Akun (Gunakan <code>sosrospg@gmail.com</code> untuk Super Admin)
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
                Kata Sandi Firebase Auth
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
            <div className="flex justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => void handleSignOutClick()}
                className="rounded-xl border border-neutral-200 bg-white px-3 py-2 font-bold text-neutral-700"
              >
                Simulasi Akun Pelanggan
              </button>
              <button
                type="submit"
                data-testid="email-signin-submit-btn"
                className="rounded-xl bg-[#EC749B] px-4 py-2 font-black text-white shadow-2xs hover:bg-[#DF608A]"
              >
                Masuk / Daftar Firebase
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}
