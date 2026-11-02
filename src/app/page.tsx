'use client';

import React, { useMemo, useState } from 'react';
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
import type {
  AutonomyConfig,
  BrandProfile,
  BrandVaultAsset,
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
  Activity,
  Bot,
  Calendar,
  Camera,
  CheckCircle2,
  CreditCard,
  Flame,
  Globe,
  Image as ImageIcon,
  Instagram,
  Layers,
  LayoutDashboard,
  Lock,
  Megaphone,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
  Video,
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
    badgeClass: 'bg-pink-100 text-pink-800 border-pink-200',
    supportsPhoto: true,
    supportsVideo: true,
  },
  facebook: {
    label: 'Facebook Page & Reels',
    shortLabel: 'Facebook',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    supportsPhoto: true,
    supportsVideo: true,
  },
  tiktok: {
    label: 'TikTok (Video & Photo Mode)',
    shortLabel: 'TikTok',
    badgeClass: 'bg-slate-900 text-white border-slate-700',
    supportsPhoto: true,
    supportsVideo: true,
  },
  youtube_shorts: {
    label: 'YouTube Shorts (9:16)',
    shortLabel: 'YT Shorts',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
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

  // Super Admin state
  const [tenants, setTenants] = useState<TenantWorkspaceSummary[]>(INITIAL_TENANT_WORKSPACES);
  const [centralCreds, setCentralCreds] = useState<CentralPlatformCredentials>(INITIAL_CENTRAL_CREDENTIALS);
  const [statusBanner, setStatusBanner] = useState<string>(
    'Veloxa AI aktif · Seluruh 4 kanal sosmed (IG, FB, TikTok, YT Shorts) & AI Agent Meta Ads siap dijalankan.',
  );

  const currentPlan = SUBSCRIPTION_PLANS[activePlanId];
  const unitEcon = useMemo(
    () =>
      calculateTenantUnitEconomics({
        planId: activePlanId,
        postsPublishedThisMonth: postsUsedThisMonth,
        realAssetRatioPct: brand.prioritizeRealAssets ? 65 : 20,
      }),
    [activePlanId, postsUsedThisMonth, brand.prioritizeRealAssets],
  );

  const adminSummary = useMemo(() => calculatePlatformAdminMetrics(tenants), [tenants]);

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

  const handleGenerateStudioDraft = (source: ContentDraft['source'] = 'manual_studio', scheduledSlotWib?: string) => {
    const quotaGuard = canConsumePostingQuota({
      planId: activePlanId,
      postsPublishedThisMonth: postsUsedThisMonth,
    });
    if (!quotaGuard.allowed) {
      setStatusBanner(quotaGuard.reason || 'Kuota bulanan habis.');
      return;
    }

    const activeCamp = eventCampaigns.find((c) => c.status === 'active');
    const created = generateBrandContentDraft({
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

    setDrafts((prev) => [created, ...prev]);
    setPostsUsedThisMonth((prev) => prev + 1);
    setStudioTopic('');
    setStatusBanner(
      `Konten "${created.title}" (${created.format}) berhasil dibuat, lolos Quality Gate (${created.qualityReview.score}/100 · 0 issue), dan siap tayang di ${created.targetChannels.length} platform!`,
    );
  };

  const handlePublishDraftNow = (draftId: string) => {
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

  const handleToggleMetaCampaignRun = (campaignId: string) => {
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

  const organicWinnerDraft = drafts.find((d) => d.organicMetrics?.isOrganicWinner);

  return (
    <div className="min-h-dvh bg-slate-100/80 pb-24">
      {/* Top Global Control Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-950 text-white shadow-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-emerald-400 font-black text-white shadow-md">
              V
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black tracking-tight">VELOXA AI</span>
                <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-bold text-indigo-300 ring-1 ring-indigo-400/30">
                  Web · Android · iOS
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Autonomous Social Content Studio & AI Meta Ads Marketing Agent
              </p>
            </div>
          </div>

          {/* Role Switcher & Viewport Mode Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Pilih Peran Aplikasi"
              className="flex rounded-xl bg-slate-900 p-1 ring-1 ring-slate-800"
            >
              <button
                type="button"
                onClick={() => setActiveRole('user')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  activeRole === 'user'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Role: USER Workspace
              </button>
              <button
                type="button"
                onClick={() => setActiveRole('admin')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  activeRole === 'admin'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Role: SUPER ADMIN
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                setViewportMode((m) => (m === 'desktop_web' ? 'mobile_native' : 'desktop_web'))
              }
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800"
            >
              <Smartphone className="h-3.5 w-3.5 text-emerald-400" />
              {viewportMode === 'desktop_web'
                ? 'Tampilan: Web Desktop'
                : 'Tampilan: Native Mobile (Android/iOS)'}
            </button>
          </div>
        </div>

        {/* Status Toast Strip */}
        <div className="border-t border-slate-800/80 bg-slate-900/90 px-4 py-1.5 text-xs text-slate-300">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
              {statusBanner}
            </span>
            {activeRole === 'user' && (
              <span className="shrink-0 font-semibold text-indigo-300">
                Paket Aktif: {currentPlan.name} ({formatIdr(currentPlan.priceMonthlyIdr)}/bln) · Kuota{' '}
                {postsUsedThisMonth}/{currentPlan.monthlyPostQuota}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Container (Supports Wide Desktop Web OR Native Phone Shell Preview) */}
      <main
        className={`mx-auto transition-all duration-300 ${
          viewportMode === 'mobile_native'
            ? 'my-6 max-w-[430px] overflow-hidden rounded-[42px] border-[10px] border-slate-900 bg-slate-50 shadow-2xl'
            : 'max-w-7xl px-4 py-6 sm:px-6'
        }`}
      >
        {viewportMode === 'mobile_native' && (
          <div className="flex items-center justify-between bg-slate-900 px-6 py-2 text-[11px] font-bold text-white">
            <span>09:41</span>
            <span className="rounded-full bg-slate-800 px-3 py-0.5 text-[10px] text-emerald-400">
              Veloxa iOS / Android Shell
            </span>
            <span>5G · 100%</span>
          </div>
        )}

        <div className={viewportMode === 'mobile_native' ? 'p-4 pb-24' : ''}>
          {activeRole === 'admin' ? (
            /* ======================================================================
               ROLE 1: SUPER ADMIN COMMAND CENTER (OWNER SAAS)
               ====================================================================== */
            <div className="space-y-6" data-testid="super-admin-dashboard">
              <div className="flex flex-col justify-between gap-4 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-lg sm:flex-row sm:items-center">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
                    <ShieldCheck className="h-3.5 w-3.5" /> Super Admin Control Center
                  </span>
                  <h1 className="veloxa-hero-title mt-2 font-black tracking-tight">
                    Manajemen Bisnis SaaS Veloxa AI
                  </h1>
                  <p className="mt-1 text-sm text-slate-300">
                    Pantau pendapatan langganan (Rp500rb – Rp1,5jt), margin API AI, kuota pelanggan, dan kredensial OAuth terpusat.
                  </p>
                </div>
                <div className="rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Gross Margin SaaS
                  </p>
                  <p className="text-3xl font-black">{adminSummary.averageGrossMarginPct}%</p>
                  <p className="text-xs text-slate-300">Target sehat: &gt;75%</p>
                </div>
              </div>

              {/* Admin KPI Row */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase text-slate-400">Pendapatan Bulanan (MRR)</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">
                    {formatIdr(adminSummary.totalMrrIdr)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-emerald-600">
                    {tenants.length} bisnis aktif berlangganan
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase text-slate-400">Modal API (OpenAI + Render)</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">
                    {formatIdr(adminSummary.totalApiCostIdr)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Untuk {adminSummary.totalPublishedPosts} konten tayang bulan ini
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase text-slate-400">Laba Bersih SaaS</p>
                  <p className="mt-2 text-2xl font-black text-emerald-600">
                    {formatIdr(adminSummary.totalNetProfitIdr)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    Margin kotor {adminSummary.averageGrossMarginPct}%
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase text-slate-400">Kampanye AI Meta Ads</p>
                  <p className="mt-2 text-2xl font-black text-indigo-600">
                    {adminSummary.totalActiveMetaCampaigns} Aktif
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Ad spend ditarik langsung dari kartu user
                  </p>
                </div>
              </div>

              {/* Subscription Pricing Tiers Overview */}
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-black text-slate-900">
                   Katalog Paket Langganan Veloxa AI (Rp500rb – Rp1,5 Juta)
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Pembayaran langganan dilakukan via Web (Midtrans/Xendit QRIS & VA) agar bebas potongan 30% App Store / Play Store.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  {Object.values(SUBSCRIPTION_PLANS).map((plan) => (
                    <div
                      key={plan.id}
                      className={`rounded-2xl border p-5 ${
                        plan.id === 'pro_1500k'
                          ? 'border-indigo-300 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 bg-slate-50/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black text-slate-900">{plan.name}</span>
                        {plan.id === 'pro_1500k' && (
                          <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
                            TERLARIS
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-2xl font-black text-indigo-700">
                        {formatIdr(plan.priceMonthlyIdr)}
                        <span className="text-xs font-semibold text-slate-500">/bulan</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-600">{plan.tagline}</p>
                      <ul className="mt-3 space-y-1.5 text-xs text-slate-700">
                        <li>• Kuota: <strong>{plan.monthlyPostQuota} postingan/bulan</strong> (maks {plan.maxPostsPerDay}x/hari)</li>
                        <li>• Kanal: <strong>{plan.allowedChannels.join(', ').toUpperCase()}</strong></li>
                        <li>• Kampanye Event: <strong>{plan.includesEventCampaigns ? 'Termasuk' : 'Tidak'}</strong></li>
                        <li>• AI Agent Meta Ads: <strong>{plan.includesMetaAdsAgent ? 'Termasuk + Auto-Optimizer' : 'Tidak'}</strong></li>
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              {/* Accessible Sticky Responsive Tenant Table (modern-web-guidance responsive-table) */}
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 id="tenant-table-caption" className="text-lg font-black text-slate-900">
                      Daftar Pelanggan (Tenants) & Kontrol Kuota
                    </h2>
                    <p className="text-xs text-slate-500">
                      Ubah paket pelanggan secara instan atau pantau margin pemakaian API masing-masing brand.
                    </p>
                  </div>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="tenant-table-caption"
                  className="veloxa-table-region rounded-2xl border border-slate-200"
                >
                  <table className="text-left text-sm">
                    <thead className="bg-slate-900 text-xs uppercase text-slate-200">
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
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {tenants.map((t) => (
                        <tr key={t.workspaceId} className="hover:bg-slate-50">
                          <th className="px-4 py-3.5 font-bold text-slate-900">
                            <div>{t.businessName}</div>
                            <div className="text-xs font-normal text-slate-500">
                              {t.ownerName} · {t.ownerEmail}
                            </div>
                          </th>
                          <td className="px-4 py-3.5 text-xs font-semibold uppercase text-slate-600">
                            {t.category.replace('_', ' ')}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold text-indigo-800">
                              {SUBSCRIPTION_PLANS[t.planId].name}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-xs font-bold text-slate-800">
                            {t.postsPublishedThisMonth} / {t.monthlyPostQuota} post
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-600">
                            <div>{t.connectedChannels.length} Sosmed Aktif</div>
                            <div className="font-semibold text-emerald-700">
                              {t.metaAdsConnected ? `${t.activeMetaCampaigns} Kampanye Meta Ads` : 'Tanpa Meta Ads'}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-xs">
                            <div className="font-bold text-slate-900">
                               Bayar: {formatIdr(t.monthlySubscriptionRevenueIdr)}
                            </div>
                            <div className="text-slate-500">
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
                              className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800"
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
              <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <Lock className="h-5 w-5 text-indigo-600" />
                  <h2 className="text-lg font-black text-slate-900">
                    Brankas API & OAuth Terpusat (Dikelola Pemilik SaaS)
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  User tidak perlu membuat API sendiri. Seluruh login Instagram, Facebook, TikTok, YouTube Shorts, dan Meta Ads memakai aplikasi resmi Veloxa AI di bawah ini.
                </p>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-xs font-black uppercase text-slate-400">OpenAI Master Engine</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      {centralCreds.openAiModelText} · {centralCreds.openAiModelImage} · {centralCreds.openAiModelVoice}
                    </p>
                    <p className="mt-1 text-xs text-emerald-700">
                      ✓ API Key Terpusat Aktif · Batas Auto-Repair: {centralCreds.globalMaxRepairAttemptsPerJob}x/job
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-xs font-black uppercase text-slate-400">Meta Graph & Marketing API</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      App ID: {centralCreds.metaAppId}
                    </p>
                    <p className="mt-1 text-xs text-emerald-700">
                      ✓ Advanced Access Ready (IG + FB + ads_management)
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-xs font-black uppercase text-slate-400">TikTok & YouTube Shorts</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">
                      TikTok Direct Post · YT Quota {centralCreds.youtubeDailyQuotaUnits.toLocaleString('id-ID')}/hari
                    </p>
                    <p className="mt-1 text-xs text-emerald-700">
                      ✓ Payment Gateway: {centralCreds.paymentGatewayProvider} (QRIS & Virtual Account)
                    </p>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            /* ======================================================================
               ROLE 2: USER WORKSPACE (CAFE, EVENT LARI, KLINIK, BRAND)
               ====================================================================== */
            <div className="space-y-6" data-testid="user-workspace-dashboard">
              {/* Industry Preset Switcher Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl font-black text-white shadow"
                    style={{ backgroundColor: brand.primaryColorHex }}
                  >
                    {brand.businessName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-lg font-black text-slate-900">{brand.businessName}</h1>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                        {brand.city}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Contoh Workspace Pelanggan · Pilih simulasi jenis bisnis di sebelah kanan:
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
                          ? 'bg-slate-900 text-white shadow'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Desktop Horizontal Navigation Tabs */}
              {viewportMode === 'desktop_web' && (
                <nav
                  aria-label="Menu Utama User Workspace"
                  className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-5"
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
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                            : 'text-slate-600 hover:bg-slate-100'
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
                  {/* Organic Winner Auto-Boost Alert Banner */}
                  {organicWinnerDraft && (
                    <div className="flex flex-col justify-between gap-4 rounded-3xl border border-amber-300 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 p-5 shadow-sm sm:flex-row sm:items-center">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white">
                          <Flame className="h-5 w-5" />
                        </div>
                        <div>
                          <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-900">
                            Rekomendasi Pintar AI Marketing
                          </span>
                          <h2 className="mt-1 text-base font-black text-slate-900">
                            Konten Organik Sedang Ramai! ({organicWinnerDraft.organicMetrics?.reach.toLocaleString('id-ID')} Reach · Engagement {organicWinnerDraft.organicMetrics?.engagementRatePct}%)
                          </h2>
                          <p className="mt-0.5 text-xs text-slate-700">
                            Reels <strong>&ldquo;{organicWinnerDraft.title}&rdquo;</strong> punya performa organik sangat tinggi. Ubah menjadi kampanye Meta Ads ({formatIdr(organicWinnerDraft.organicMetrics?.recommendedAdDailyBudgetIdr || 150_000)}/hari) untuk menjangkau ribuan calon pembeli baru di {brand.city}!
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDesignMetaAdsWithAi(organicWinnerDraft)}
                        className="shrink-0 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black text-white shadow hover:bg-slate-800"
                      >
                        <Rocket className="mr-1.5 inline h-4 w-4 text-amber-400" />
                        Boost Jadi Meta Ads 1-Klik
                      </button>
                    </div>
                  )}

                  {/* 4 Social Channels OAuth Connection Cards */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">
                          Hubungkan Akun Media Sosial Anda (OAuth 1-Klik)
                        </h2>
                        <p className="text-xs text-slate-500">
                          Tidak perlu membuat API Key sendiri—cukup klik Hubungkan dan login ke akun medsos bisnis Anda.
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                        {connections.filter((c) => c.connected).length} dari 4 Platform Terhubung
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {connections.map((conn) => {
                        const meta = CHANNEL_META[conn.channel];
                        return (
                          <div
                            key={conn.channel}
                            className={`flex flex-col justify-between rounded-2xl border p-4 transition ${
                              conn.connected
                                ? 'border-emerald-200 bg-emerald-50/40'
                                : 'border-slate-200 bg-slate-50'
                            }`}
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
                                    conn.connected ? 'text-emerald-700' : 'text-slate-400'
                                  }`}
                                >
                                  {conn.connected ? '● Terhubung' : '○ Terputus'}
                                </span>
                              </div>
                              <p className="mt-3 text-sm font-black text-slate-900">{meta.label}</p>
                              <p className="mt-1 text-xs font-semibold text-slate-700">
                                {conn.connected ? `${conn.handle} · ${conn.followerCount.toLocaleString('id-ID')} pengikut` : 'Belum ditautkan'}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {conn.connected
                                  ? `Tayang terakhir: ${conn.lastPublishedAt}`
                                  : 'Mendukung jadwal otomatis & publikasi instan'}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleToggleChannel(conn.channel)}
                              className={`mt-4 w-full rounded-xl py-2 text-xs font-bold transition ${
                                conn.connected
                                  ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
                              }`}
                            >
                              {conn.connected ? 'Putuskan / Hubungkan Ulang' : `Hubungkan ${meta.shortLabel}`}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Meta Ads Account Connection & Quick Summary */}
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                          Meta Marketing API · Ads Manager
                        </span>
                        <span className="text-xs font-bold text-emerald-700">
                          ✓ Terhubung ({metaAccount.adAccountId})
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-slate-900">
                        {metaAccount.adAccountName}
                      </h3>
                      <p className="mt-1 text-xs text-slate-600">
                        Tagihan iklan dibayar langsung oleh metode pembayaran Anda di Meta ({metaAccount.paymentMethodLabel}).
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3.5 text-xs">
                        <div>
                          <span className="text-slate-500">Pagar Budget Harian Maks:</span>
                          <p className="text-sm font-black text-slate-900">
                            {formatIdr(metaAccount.dailyHardCapIdr)}/hari
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">AI Media Buyer Optimizer:</span>
                          <p className="text-sm font-black text-emerald-700">
                            {metaAccount.autoOptimizeEnabled ? 'Aktif Otomatis 24/7' : 'Manual'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('meta_ads')}
                        className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
                      >
                        Buka AI Agent Marketing (Meta Ads) →
                      </button>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">
                          Ringkasan Kuota & Otonomi
                        </span>
                        <span className="text-xs font-bold text-slate-600">
                          {currentPlan.name} ({formatIdr(currentPlan.priceMonthlyIdr)}/bln)
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-black text-slate-900">
                        Terpakai {postsUsedThisMonth} dari {currentPlan.monthlyPostQuota} Kuota Postingan Bulan Ini
                      </h3>
                      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-emerald-500"
                          style={{
                            width: `${Math.min(100, Math.round((postsUsedThisMonth / currentPlan.monthlyPostQuota) * 100))}%`,
                          }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-600">
                        Jadwal Otonom aktif: <strong>{autonomyConfig.postsPerDay}x sehari</strong> ({autonomyConfig.scheduleTimesWib.join(' & ')} WIB) · Mode{' '}
                        <strong>
                          {autonomyConfig.executionMode === 'full_autonomous'
                            ? '100% Full Otonom'
                            : 'Co-Pilot Tinjau H-1'}
                        </strong>
                      </p>
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setActiveTab('studio')}
                          className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-700"
                        >
                          Buat Konten di Studio
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('autonomy')}
                          className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-50"
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
                  <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                    {/* Brand Brain Configuration */}
                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">
                        Brand Brain · Otak Identitas Bisnis
                      </span>
                      <h2 className="mt-2 text-lg font-black text-slate-900">
                        Pengaturan Karakter & Produk Unggulan
                      </h2>
                      <p className="text-xs text-slate-500">
                        AI Agent mempelajari profil ini agar setiap naskah, visual, dan voiceover Reels terasa 100% khas bisnis Anda.
                      </p>

                      <div className="mt-4 space-y-3.5 text-xs">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="font-bold text-slate-700">Nama Bisnis / Acara</label>
                            <input
                              type="text"
                              value={brand.businessName}
                              onChange={(e) => setBrand({ ...brand, businessName: e.target.value })}
                              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold"
                            />
                          </div>
                          <div>
                            <label className="font-bold text-slate-700">Kota / Target Area</label>
                            <input
                              type="text"
                              value={brand.city}
                              onChange={(e) => setBrand({ ...brand, city: e.target.value })}
                              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="font-bold text-slate-700">Target Audiens</label>
                          <input
                            type="text"
                            value={brand.targetAudience}
                            onChange={(e) => setBrand({ ...brand, targetAudience: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-slate-700">Gaya Bahasa & Tone Merek</label>
                          <input
                            type="text"
                            value={brand.brandTone}
                            onChange={(e) => setBrand({ ...brand, brandTone: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-slate-700">
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
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-slate-700">Ajakan Bertindak (Default CTA)</label>
                          <input
                            type="text"
                            value={brand.defaultCta}
                            onChange={(e) => setBrand({ ...brand, defaultCta: e.target.value })}
                            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                          />
                        </div>

                        <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                          <input
                            type="checkbox"
                            checked={brand.prioritizeRealAssets}
                            onChange={(e) =>
                              setBrand({ ...brand, prioritizeRealAssets: e.target.checked })
                            }
                            className="h-4 w-4 accent-emerald-600"
                          />
                          <span>
                            <strong className="block text-emerald-950">
                              Prioritaskan Foto & Klip Video Asli Saya di Setiap Konten AI
                            </strong>
                            <span className="text-emerald-800">
                              AI akan mengambil foto menu cafe / foto pelari asli dari Laci 2 dan memadukannya dengan tipografi & voiceover otomatis.
                            </span>
                          </span>
                        </label>
                      </div>
                    </section>

                    {/* Upload to Dual Brand Vault */}
                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-800">
                        Dual Brand Vault · Web, Kamera Android & iOS
                      </span>
                      <h2 className="mt-2 text-lg font-black text-slate-900">
                        Upload Contoh Referensi atau Dokumentasi Asli
                      </h2>
                      <p className="text-xs text-slate-500">
                        Unggah contoh poster/Reels yang Anda sukai (untuk ditiru gayanya oleh AI) atau stok foto/video asli bisnis Anda.
                      </p>

                      <div className="mt-4 space-y-3 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setNewAssetDrawer('style_reference')}
                            className={`rounded-xl border p-3 text-left font-bold transition ${
                              newAssetDrawer === 'style_reference'
                                ? 'border-violet-600 bg-violet-50 text-violet-950'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                            }`}
                          >
                            <Sparkles className="mb-1 h-4 w-4 text-violet-600" />
                            Laci 1: Contoh Referensi Gaya (Style DNA)
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewAssetDrawer('real_asset')}
                            className={`rounded-xl border p-3 text-left font-bold transition ${
                              newAssetDrawer === 'real_asset'
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                            }`}
                          >
                            <Camera className="mb-1 h-4 w-4 text-emerald-600" />
                            Laci 2: Foto / Video Asli Milik Bisnis
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="font-bold text-slate-700">Jenis Media</label>
                            <select
                              value={newAssetMediaType}
                              onChange={(e) =>
                                setNewAssetMediaType(e.target.value as 'photo' | 'video_reel')
                              }
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-semibold"
                            >
                              <option value="photo">Foto / Poster / Carousel</option>
                              <option value="video_reel">Video Reels / TikTok (9:16)</option>
                            </select>
                          </div>
                          <div>
                            <label className="font-bold text-slate-700">Judul / Catatan Aset</label>
                            <input
                              type="text"
                              placeholder="Misal: Foto Pelari 10K / Kopi Susu"
                              value={newAssetTitle}
                              onChange={(e) => setNewAssetTitle(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => void handleUploadVaultAsset(false)}
                            className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 font-black text-white shadow hover:bg-indigo-700"
                          >
                            <Upload className="mr-1.5 inline h-4 w-4" />
                            Simpan ke {newAssetDrawer === 'style_reference' ? 'Laci Referensi Gaya' : 'Galeri Aset Asli'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUploadVaultAsset(true)}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-bold text-slate-800 hover:bg-slate-50"
                          >
                            <Camera className="mr-1.5 inline h-4 w-4 text-emerald-600" />
                            Kamera / File HP
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* Vault Gallery Display */}
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <h3 className="text-base font-black text-slate-900">
                      Isi Brand Vault Anda ({vaultAssets.length} Aset Tersimpan)
                    </h3>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {vaultAssets.map((asset) => (
                        <article
                          key={asset.id}
                          className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                        >
                          <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-900">
                            <img
                              src={asset.previewUrl}
                              alt={asset.title}
                              className="h-full w-full object-cover opacity-90"
                            />
                            <span
                              className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                                asset.drawer === 'style_reference'
                                  ? 'bg-violet-600 text-white'
                                  : 'bg-emerald-600 text-white'
                              }`}
                            >
                              {asset.drawer === 'style_reference' ? 'Referensi Gaya' : 'Aset Asli User'}
                            </span>
                            <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">
                              {asset.mediaType === 'video_reel' ? 'Reels 9:16' : 'Foto 4:5'} · via {asset.uploadedFrom.toUpperCase()}
                            </span>
                          </div>
                          <div className="p-3.5 text-xs">
                            <h4 className="font-black text-slate-900">{asset.title}</h4>
                            <p className="mt-1 text-slate-600">{asset.description}</p>
                            {asset.extractedStyleDna && (
                              <div className="mt-2.5 rounded-xl bg-violet-100/70 p-2.5 text-[11px] text-violet-950">
                                <strong>Style DNA Diekstrak AI:</strong>
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
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800">
                          Studio Konten AI · Self-Healing Quality Gate
                        </span>
                        <h2 className="mt-2 text-lg font-black text-slate-900">
                          Buat Konten Baru Sesuai Referensi & Aset {brand.businessName}
                        </h2>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div>
                        <label className="text-xs font-bold text-slate-700">Format Konten</label>
                        <select
                          value={studioFormat}
                          onChange={(e) => setStudioFormat(e.target.value as ContentFormat)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold"
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
                        <label className="text-xs font-bold text-slate-700">
                          Topik / Brief Khusus (Kosongkan bila ingin AI memilih otomatis dari Brand Brain & Event)
                        </label>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            placeholder={`Contoh: Promo ${brand.offerings[0]?.title || brand.businessName} minggu ini...`}
                            value={studioTopic}
                            onChange={(e) => setStudioTopic(e.target.value)}
                            className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleGenerateStudioDraft('manual_studio')}
                            className="shrink-0 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white shadow hover:bg-indigo-700"
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
                        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-800">
                                {draft.status === 'published' ? '✓ Sudah Tayang' : '✓ Lolos Pemeriksaan AI'}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                                {draft.format === 'short_video'
                                  ? `Video 9:16 (${draft.videoDurationSeconds || 28} dtk)`
                                  : draft.format === 'carousel'
                                    ? `Carousel (${draft.slides?.length || 4} Slide)`
                                    : 'Post Tunggal'}
                              </span>
                              {draft.usedRealAssetIds.length > 0 && (
                                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-800">
                                  Memakai {draft.usedRealAssetIds.length} Foto/Video Asli User
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 text-base font-black text-slate-900">{draft.title}</h3>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {draft.status !== 'published' && (
                              <button
                                type="button"
                                onClick={() => handlePublishDraftNow(draft.id)}
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow hover:bg-emerald-700"
                              >
                                <Send className="mr-1.5 inline h-3.5 w-3.5" />
                                Terbitkan ke {draft.targetChannels.length} Sosmed Sekarang
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDesignMetaAdsWithAi(draft)}
                              className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-100"
                            >
                              <Megaphone className="mr-1.5 inline h-3.5 w-3.5" />
                              Jadikan Materi Meta Ads
                            </button>
                          </div>
                        </div>

                        {/* Quality Gate Proof */}
                        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950">
                          <div className="flex items-center justify-between font-bold">
                            <span>
                              ✓ Self-Healing Quality Gate: {draft.qualityReview.score}/100 (0 Masalah Tersisa)
                            </span>
                            <span>Iterasi perbaikan: {draft.qualityReview.repairAttempts}x</span>
                          </div>
                          <p className="mt-1 text-emerald-800">{draft.qualityReview.summary}</p>
                        </div>

                        {/* Multi-Channel Distribution Badges */}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-slate-500">Distribusi Lintas Platform:</span>
                          {draft.channelStatuses.map((cs) => (
                            <span
                              key={cs.channel}
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${CHANNEL_META[cs.channel].badgeClass}`}
                            >
                              {CHANNEL_META[cs.channel].shortLabel}:{' '}
                              {cs.status === 'published' ? 'Sudah Tayang' : 'Siap Kirim'}
                            </span>
                          ))}
                        </div>

                        {/* Storyboard / Slides Preview */}
                        {draft.videoScenes && (
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {draft.videoScenes.map((scene) => (
                              <div
                                key={scene.sceneNumber}
                                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-900 p-4 text-xs text-white"
                              >
                                <div>
                                  <div className="flex items-center justify-between text-[11px] font-bold text-emerald-400">
                                    <span>ADEGAN {scene.sceneNumber}</span>
                                    <span>{scene.timeRange}</span>
                                  </div>
                                  <p className="mt-2 font-black text-white">{scene.textOverlay}</p>
                                  <p className="mt-2 text-[11px] text-slate-300">
                                    <strong>VO:</strong> &ldquo;{scene.voiceover}&rdquo;
                                  </p>
                                </div>
                                <p className="mt-3 border-t border-slate-800 pt-2 text-[10px] text-indigo-300">
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
                                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs"
                              >
                                <div className="flex items-center justify-between font-bold text-indigo-600">
                                  <span>SLIDE 0{slide.slideNumber}</span>
                                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px]">
                                    {slide.badgeText}
                                  </span>
                                </div>
                                <p className="mt-2 font-black text-slate-900">{slide.headline}</p>
                                <p className="mt-1 text-slate-600">{slide.body}</p>
                                <p className="mt-2 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
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
                  <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                    {/* User-Controlled Autonomous Schedule */}
                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                          Agent Konten Otonom 24/7
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAutonomyConfig((c) => ({ ...c, enabled: !c.enabled }))
                          }
                          className={`rounded-full px-3.5 py-1 text-xs font-black ${
                            autonomyConfig.enabled
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {autonomyConfig.enabled ? '● Otonom Aktif' : '○ Dijeda'}
                        </button>
                      </div>

                      <h2 className="mt-2 text-lg font-black text-slate-900">
                        Atur Sendiri Frekuensi & Jam Posting Harian Anda
                      </h2>
                      <p className="text-xs text-slate-500">
                        Agent akan memilih ide topik, memadukan foto/video dari Brand Vault, memeriksa kualitas sampai 0 masalah, dan menerbitkan otomatis ke kanal Anda.
                      </p>

                      <div className="mt-4 space-y-4 text-xs">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="font-bold text-slate-700">
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
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold"
                            >
                              <option value={1}>1x Sehari (30 konten/bulan)</option>
                              <option value={2}>2x Sehari · Pagi & Malam (60 konten/bulan)</option>
                              <option value={3}>3x Sehari · Pagi, Siang, Malam (90 konten/bulan)</option>
                              <option value={4}>4x Sehari · Agresif Kampanye</option>
                            </select>
                          </div>

                          <div>
                            <label className="font-bold text-slate-700">Mode Kepercayaan Otonom</label>
                            <select
                              value={autonomyConfig.executionMode}
                              onChange={(e) =>
                                setAutonomyConfig({
                                  ...autonomyConfig,
                                  executionMode: e.target.value as AutonomyConfig['executionMode'],
                                })
                              }
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold"
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
                          <label className="font-bold text-slate-700">
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
                                className="rounded-xl border border-slate-300 px-3 py-1.5 font-bold text-slate-900"
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-slate-50 p-4">
                          <p className="font-bold text-slate-800">
                            Komposisi Pilar Konten Otomatis:
                          </p>
                          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                            <div className="rounded-xl bg-white p-2.5 shadow-sm">
                              <span className="text-lg font-black text-indigo-600">
                                {autonomyConfig.contentMixPct.educationTips}%
                              </span>
                              <p className="text-[11px] text-slate-600">Edukasi & Tips</p>
                            </div>
                            <div className="rounded-xl bg-white p-2.5 shadow-sm">
                              <span className="text-lg font-black text-emerald-600">
                                {autonomyConfig.contentMixPct.communityStory}%
                              </span>
                              <p className="text-[11px] text-slate-600">Cerita & Testimoni</p>
                            </div>
                            <div className="rounded-xl bg-white p-2.5 shadow-sm">
                              <span className="text-lg font-black text-amber-600">
                                {autonomyConfig.contentMixPct.productEventPromo}%
                              </span>
                              <p className="text-[11px] text-slate-600">Promo Produk/Event</p>
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
                          className="w-full rounded-2xl bg-slate-900 py-3 font-black text-white shadow hover:bg-slate-800"
                        >
                          <Bot className="mr-1.5 inline h-4 w-4 text-emerald-400" />
                          Jalankan 1 Slot Agent Otonom Sekarang (Simulasi Produksi & Jadwal)
                        </button>
                      </div>
                    </section>

                    {/* Event Campaign Countdown Manager */}
                    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                        Mode Kampanye Event & Promo Terjadwal
                      </span>
                      <h2 className="mt-2 text-lg font-black text-slate-900">
                        Kalender Hitung Mundur Event (Teaser → Early Bird → Hari-H)
                      </h2>
                      <p className="text-xs text-slate-500">
                        Sangat cocok untuk Event Lari, Launching Menu Baru Cafe, atau Promo Tanggal Kembar.
                      </p>

                      <div className="mt-4 space-y-3 text-xs">
                        {eventCampaigns.map((camp) => {
                          const phase = computeEventCampaignPhase(camp.eventDateIso);
                          return (
                            <div
                              key={camp.id}
                              className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4"
                            >
                              <div className="flex items-center justify-between">
                                <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
                                  {phase.phaseLabel}
                                </span>
                                <span className="font-bold text-slate-600">
                                  Target: {camp.currentConversions}/{camp.targetRegistrationsOrSales} pendaftar/pembeli
                                </span>
                              </div>
                              <h3 className="mt-2 text-sm font-black text-slate-900">{camp.name}</h3>
                              <p className="mt-0.5 text-slate-700">{camp.ticketOrPromoHighlight}</p>
                              <p className="mt-1.5 text-[11px] font-semibold text-indigo-900">
                                Arahan AI Hari Ini: {phase.contentAngleDirective}
                              </p>
                            </div>
                          );
                        })}

                        <div className="rounded-2xl border border-slate-200 p-3.5">
                          <p className="font-bold text-slate-800">+ Tambah Kampanye Event Baru</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <input
                              type="text"
                              placeholder="Nama Event (misal: Jakarta Night Run 10K)"
                              value={newCampaignName}
                              onChange={(e) => setNewCampaignName(e.target.value)}
                              className="rounded-xl border border-slate-300 px-3 py-2"
                            />
                            <input
                              type="date"
                              value={newCampaignDate}
                              onChange={(e) => setNewCampaignDate(e.target.value)}
                              className="rounded-xl border border-slate-300 px-3 py-2"
                            />
                          </div>
                          <input
                            type="text"
                            placeholder="Info Tiket / Promo Utama (misal: Early Bird Rp199rb + Medali)"
                            value={newCampaignHighlight}
                            onChange={(e) => setNewCampaignHighlight(e.target.value)}
                            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"
                          />
                          <button
                            type="button"
                            onClick={handleCreateEventCampaign}
                            className="mt-2 w-full rounded-xl bg-indigo-600 py-2.5 font-bold text-white hover:bg-indigo-700"
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
                  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
                          AI Agent Marketing · Terhubung ke Meta Marketing API
                        </span>
                        <h2 className="mt-2 text-lg font-black text-slate-900">
                          Rancang, Susun Demografi & Interest, dan Eksekusi Meta Ads Otomatis
                        </h2>
                        <p className="text-xs text-slate-500">
                          AI memvalidasi ID Interest resmi di Meta Graph API, memetakan radius lokasi, membagi A/B testing materi iklan, dan menjaga budget di bawah pagar pengaman Anda.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="font-bold text-slate-700">Tujuan Kampanye (Objective)</label>
                        <select
                          value={adObjective}
                          onChange={(e) => setAdObjective(e.target.value as MetaAdObjective)}
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-bold"
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
                        <label className="font-bold text-slate-700">Produk / Event yang Diiklankan</label>
                        <input
                          type="text"
                          value={adPromoTitle}
                          onChange={(e) => setAdPromoTitle(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-semibold"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-slate-700">
                          Kota Target & Radius (km)
                        </label>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="text"
                            value={adCity}
                            onChange={(e) => setAdCity(e.target.value)}
                            className="w-2/3 rounded-xl border border-slate-300 px-3 py-2.5 font-semibold"
                          />
                          <input
                            type="number"
                            value={adRadiusKm}
                            min={3}
                            max={80}
                            onChange={(e) => setAdRadiusKm(Number(e.target.value))}
                            className="w-1/3 rounded-xl border border-slate-300 px-2.5 py-2.5 font-bold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-bold text-slate-700">
                          Rentang Usia Demografi ({adAgeMin} – {adAgeMax} thn)
                        </label>
                        <div className="mt-1 flex gap-2">
                          <input
                            type="number"
                            value={adAgeMin}
                            min={18}
                            max={55}
                            onChange={(e) => setAdAgeMin(Number(e.target.value))}
                            className="w-1/2 rounded-xl border border-slate-300 px-3 py-2.5 font-bold"
                          />
                          <input
                            type="number"
                            value={adAgeMax}
                            min={20}
                            max={65}
                            onChange={(e) => setAdAgeMax(Number(e.target.value))}
                            className="w-1/2 rounded-xl border border-slate-300 px-3 py-2.5 font-bold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="font-bold text-slate-700">
                          Kata Kunci Interest Tambahan
                        </label>
                        <input
                          type="text"
                          value={adCustomInterest}
                          onChange={(e) => setAdCustomInterest(e.target.value)}
                          placeholder="Misal: Strava, Kopi Gayo, Skincare"
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-slate-700">Budget Harian (IDR)</label>
                        <input
                          type="number"
                          step={25000}
                          value={adDailyBudgetIdr}
                          onChange={(e) => setAdDailyBudgetIdr(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-black text-indigo-700"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-slate-700">Durasi Tayang (Hari)</label>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={adDurationDays}
                          onChange={(e) => setAdDurationDays(Number(e.target.value))}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 font-bold"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-emerald-800">
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
                          className="mt-1 w-full rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 font-black text-emerald-900"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2">
                      <p className="text-xs text-slate-500">
                        Estimasi total anggaran: <strong>{formatIdr(Math.min(adDailyBudgetIdr, metaAccount.dailyHardCapIdr) * adDurationDays)}</strong> ({adDurationDays} hari) · Ditarik langsung oleh Meta dari akun iklan <code>{metaAccount.adAccountId}</code>.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleDesignMetaAdsWithAi()}
                        className="rounded-2xl bg-indigo-600 px-6 py-3 text-xs font-black text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700"
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
                        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-3 py-0.5 text-xs font-black ${
                                  camp.status === 'active_running'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-900'
                                }`}
                              >
                                {camp.status === 'active_running'
                                  ? '● ACTIVE · Sedang Tayang di Meta Ads'
                                  : '⏸ PAUSED · Siap Diluncurkan 1-Klik'}
                              </span>
                              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                                Objective: {camp.objective.replace('_', ' ')}
                              </span>
                              {camp.budget.hardCapClamped && (
                                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                                  ✓ Dijaga Pagar Budget ({formatIdr(camp.budget.appliedDailyBudgetIdr)}/hari)
                                </span>
                              )}
                            </div>
                            <h3 className="mt-2 text-lg font-black text-slate-900">
                              {camp.campaignName}
                            </h3>
                            <p className="text-xs text-slate-500">
                              Tujuan Klik: <code>{camp.destinationUrlOrWa}</code> · Total Anggaran {camp.budget.durationDays} Hari:{' '}
                              <strong>{formatIdr(camp.budget.totalBudgetIdr)}</strong>
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleMetaCampaignRun(camp.id)}
                              className={`rounded-xl px-4 py-2.5 text-xs font-black text-white shadow ${
                                camp.status === 'active_running'
                                  ? 'bg-amber-600 hover:bg-amber-700'
                                  : 'bg-emerald-600 hover:bg-emerald-700'
                              }`}
                            >
                              {camp.status === 'active_running'
                                ? 'Jeda Kampanye'
                                : 'Setujui & Jalankan Iklan di Meta'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRunMetaAutoOptimizer(camp.id)}
                              className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white shadow hover:bg-slate-800"
                            >
                              <Zap className="mr-1.5 inline h-3.5 w-3.5 text-amber-400" />
                              Jalankan Optimasi AI Media Buyer
                            </button>
                          </div>
                        </div>

                        {/* 3 Pillars of Meta Ads: Demographics, Validated Interests, Budget & Outcome */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
                          {/* Column 1: Demografi & Geo */}
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs">
                            <p className="font-black uppercase tracking-wider text-slate-400">
                              1. Sisi Demografi & Lokasi
                            </p>
                            <ul className="mt-2.5 space-y-1.5 text-slate-700">
                              <li>
                                • <strong>Usia Target:</strong> {camp.demographics.ageMin} – {camp.demographics.ageMax} tahun
                              </li>
                              <li>
                                • <strong>Lokasi & Radius:</strong>{' '}
                                {camp.demographics.locations
                                  .map((l) => `${l.cityOrPinName} (+${l.radiusKm} km)`)
                                  .join(', ')}
                              </li>
                              <li>
                                • <strong>Bahasa:</strong> {camp.demographics.languages.join(', ')}
                              </li>
                              <li>
                                • <strong>Advantage+ Audience:</strong> Aktif dengan panduan sinyal AI
                              </li>
                            </ul>
                          </div>

                          {/* Column 2: Validated Meta Interests */}
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs">
                            <p className="font-black uppercase tracking-wider text-slate-400">
                              2. Sisi Interest Resmi Meta API
                            </p>
                            <div className="mt-2.5 space-y-2">
                              {camp.validatedInterests.slice(0, 3).map((interest) => (
                                <div
                                  key={interest.id}
                                  className="rounded-xl bg-white p-2.5 shadow-sm"
                                >
                                  <div className="flex items-center justify-between font-bold text-slate-900">
                                    <span>{interest.name}</span>
                                    <span className="text-[10px] text-indigo-600">
                                      ID #{interest.id.slice(-5)}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    Ukuran audiens: {(interest.audienceSizeLower / 1_000_000).toFixed(1)}M –{' '}
                                    {(interest.audienceSizeUpper / 1_000_000).toFixed(1)}M orang
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Column 3: Sisi Budget & Estimasi Hasil */}
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs">
                            <p className="font-black uppercase tracking-wider text-slate-400">
                              3. Sisi Budget & Proyeksi Harian
                            </p>
                            <div className="mt-2.5 space-y-2 text-slate-700">
                              <div className="flex justify-between">
                                <span>Budget Harian Aktif:</span>
                                <strong className="text-slate-900">
                                  {formatIdr(camp.budget.appliedDailyBudgetIdr)}/hari
                                </strong>
                              </div>
                              <div className="flex justify-between">
                                <span>Estimasi Jangkauan (Reach):</span>
                                <strong className="text-slate-900">
                                  {camp.estimatedDailyOutcome.reachMin.toLocaleString('id-ID')} –{' '}
                                  {camp.estimatedDailyOutcome.reachMax.toLocaleString('id-ID')} org/hari
                                </strong>
                              </div>
                              <div className="flex justify-between">
                                <span>Estimasi Klik CTA:</span>
                                <strong className="text-slate-900">
                                  {camp.estimatedDailyOutcome.estimatedClicksMin} –{' '}
                                  {camp.estimatedDailyOutcome.estimatedClicksMax} klik/hari
                                </strong>
                              </div>
                              <div className="flex justify-between">
                                <span>Target Biaya per Hasil (CPR):</span>
                                <strong className="text-emerald-700">
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
                                  ? 'border-emerald-300 bg-emerald-50/70'
                                  : cr.status === 'paused_by_ai_loser'
                                    ? 'border-rose-200 bg-rose-50/50 opacity-75'
                                    : 'border-slate-200 bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-black text-slate-900">{cr.variantLabel}</span>
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                                    cr.status === 'winner_scaled'
                                      ? 'bg-emerald-600 text-white'
                                      : cr.status === 'paused_by_ai_loser'
                                        ? 'bg-rose-600 text-white'
                                        : 'bg-indigo-100 text-indigo-800'
                                  }`}
                                >
                                  {cr.status === 'winner_scaled'
                                    ? `★ PEMENANG · Alokasi Budget ${cr.budgetSharePct}%`
                                    : cr.status === 'paused_by_ai_loser'
                                      ? '✕ DIMATIKAN AI (Biaya Mahal)'
                                      : `Alokasi Budget ${cr.budgetSharePct}%`}
                                </span>
                              </div>
                              <p className="mt-1.5 font-bold text-slate-800">{cr.headline}</p>
                              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600">
                                <span>CTR: <strong>{cr.metrics.ctrPct}%</strong></span>
                                <span>Konversi: <strong>{cr.metrics.conversions} hasil</strong></span>
                                <span>
                                  Biaya per Hasil:{' '}
                                  <strong className="text-slate-900">
                                    {formatIdr(cr.metrics.costPerResultIdr)}
                                  </strong>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* AI Media Buyer Optimization Logs */}
                        {camp.optimizationLogs.length > 0 && (
                          <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-xs">
                            <p className="font-black text-indigo-950">
                              Riwayat Tindakan Otonom AI Media Buyer:
                            </p>
                            <ul className="mt-2 space-y-1.5 text-indigo-900">
                              {camp.optimizationLogs.map((log) => (
                                <li key={log.id} className="flex items-start gap-2">
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                  <span>
                                    <strong>[{log.timestampWib}]</strong> {log.summary} (Efisiensi anggaran:{' '}
                                    <strong>{formatIdr(log.savedOrReallocatedIdr)}/hari</strong>)
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

        {/* Native Mobile Bottom Navigation Bar (When in Android/iOS Mode or Small Screens) */}
        {activeRole === 'user' && viewportMode === 'mobile_native' && (
          <nav
            aria-label="Bottom Navigation Android dan iOS"
            className="sticky bottom-0 z-20 grid grid-cols-5 border-t border-slate-200 bg-white/95 px-2 py-2.5 backdrop-blur"
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
                    activeTab === tab.id ? 'text-indigo-600' : 'text-slate-400'
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
    </div>
  );
}
