'use client';
import { VeloxaSelect } from '@/components/VeloxaSelect';
import { VeloxaSuperAdmin } from '@/components/VeloxaSuperAdmin';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {ContentIntent,ContentSourceMode} from '@/lib/content-source';
import StudioMediaPreview from '@/components/StudioMediaPreview';
import { VeloxaBrandWorkspace } from '@/components/VeloxaBrandWorkspace';
import { VeloxaBusinessSwitcher } from '@/components/VeloxaBusinessSwitcher';
import { isPublishingAccount } from '@/lib/first-post-guide';
import { VeloxaBusinessSchedule } from '@/components/VeloxaBusinessSchedule';
import { VeloxaBusinessAds } from '@/components/VeloxaBusinessAds';
import { acceptServerWorkspaceRevision } from '@/lib/veloxa-firestore-repo';
import { PRIMARY_BUSINESS, BUSINESS_DAYS, assetBusiness, draftBusiness, businessAccounts, type BusinessContext, type BusinessSchedule } from '@/lib/business-context';
import type { ContentReferenceRoles } from '@/lib/content-reference-roles';
import { profileFingerprint } from '@/lib/profile-fingerprint';
import { normalizeBrandProfile } from '@/lib/veloxa-brand-profile';
import { withConnectionPlaceholders } from '@/lib/social-account-identity';
import type { CarouselPlan } from '@/lib/carousel-plan';
import { VeloxaStudioComposer } from '@/components/VeloxaStudioComposer';
import { ContentGenerationError, type GenerationQuota, type GenerationFeedback, type GenerationStage } from '@/lib/content-generation';
import type { PublicationQuota } from '@/lib/server/publication-quota';
import PublishReviewDialog from '@/components/PublishReviewDialog';
import { useRouter } from 'next/navigation';
import {
  BRAND_PRESETS,
  SUBSCRIPTION_PLANS,
  buildMetaAdCampaignPlan,
  canConsumePostingQuota,
  computeEventCampaignPhase,
  generateBrandContentDraft,
  runMetaAdsAutonomousOptimizer,
} from '@/lib/veloxa-engine';
import {
  getInitialLocalFirstTelemetry,
  type LocalFirstTelemetry,
} from '@/lib/veloxa-local-first';
import {
  buildRealInitialWorkspaceSnapshot,
  getDefaultFirebaseConnectionConfig,
  loadSavedFirebaseConfig,
  loadWorkspaceSnapshotFromStore,
  saveChannelConnectionToFirestore,
  saveFirebaseConnectionConfig,
  syncWorkspaceSnapshotToStore,
  type VeloxaFirebaseConnectionConfig,
} from '@/lib/veloxa-firestore-repo';
import {
  INITIAL_AUTONOMY_CONFIG,
  INITIAL_CHANNEL_CONNECTIONS,
  INITIAL_EVENT_CAMPAIGNS,
  INITIAL_META_ADS_ACCOUNT,
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
  VELOXA_LOCALES,
  loadSavedVeloxaLocale,
  saveVeloxaLocale,
  type VeloxaLocale,
} from '@/lib/veloxa-i18n';
import { VeloxaSocialAccountsPanel as VeloxaMetaConnections } from '@/components/VeloxaSocialAccountsPanel';
import {createVeloxaContent} from '@/lib/veloxa-api-client';
import { veloxaApi } from '@/lib/veloxa-api-client';
import { VeloxaPublicLanding } from '@/components/VeloxaPublicLanding';
import { VeloxaPublicHeader } from '@/components/VeloxaPublicHeader';
import { VeloxaWorkspaceOverview } from '@/components/VeloxaWorkspaceOverview';
import { VeloxaWorkspaceShell, WORKSPACE_NAVIGATION } from '@/components/VeloxaWorkspaceShell';
import workspaceStyles from '@/components/VeloxaWorkspace.module.css';
import { WorkspaceLanguage, workspaceTranslator } from '@/lib/veloxa-workspace-copy';
import { workspaceCatalog } from '@/lib/workspace-catalog';
import type {
  AutonomyConfig,
  BrandProfile,
  BrandVaultAsset,
  BusinessCategory,
  ChannelConnectionState,
  ContentDraft,
  ContentFormat,
  EventCampaign,
  MetaAdCampaignPlan,
  MetaAdObjective,
  MetaAdsAccountConnection,
  SocialChannelId,
  SubscriptionPlanId,
  VeloxaRole,
} from '@/lib/veloxa-types';
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Download,
  Lock,
  Megaphone,
  Plus,
  Send,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
  X,
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

  // Multi-tenant workspace state
  const [workspaceBrand, setWorkspaceBrand] = useState<BrandProfile>(BRAND_PRESETS.running_event);
  const [businesses,setBusinesses]=useState<BusinessContext[]>([]);
  const [activeBusinessId,setActiveBusinessId]=useState(PRIMARY_BUSINESS);
  const [businessesReady,setBusinessesReady]=useState(false);
  const [businessError,setBusinessError]=useState('');
  const [managingBusiness, setManagingBusiness] = useState(false);
  const [businessSaving,setBusinessSaving]=useState(false);
  const [profileDirty,setProfileDirty]=useState(false);
  const [profileBusy,setProfileBusy]=useState(false);
  const [adsSourceDraft,setAdsSourceDraft]=useState<ContentDraft|undefined>();
  const activeBusiness:BusinessContext=businesses.find(item=>item.id===activeBusinessId)||{id:PRIMARY_BUSINESS,revision:0,brand:workspaceBrand,connectionIds:[],schedule:{connectionIds:[],timesWib:['08:00','19:00'],days:[...BUSINESS_DAYS]}};
  const brand=activeBusiness.id===PRIMARY_BUSINESS?workspaceBrand:activeBusiness.brand;
  const [activePlanId, setActivePlanId] = useState<SubscriptionPlanId>('free_trial');
  const [postsUsedThisMonth, setPostsUsedThisMonth] = useState<number>(0);
  const [publicationQuota, setPublicationQuota] = useState<PublicationQuota | null>(null);
  const [connections, setConnections] = useState<ChannelConnectionState[]>(INITIAL_CHANNEL_CONNECTIONS.map(connection => ({ ...connection, connected: false, handle: '', accountName: 'Belum Terhubung', followerCount: 0, tokenExpiresAt: null, oauthMode: 'disconnected', lastPublishedAt: null })));
  const [connectionsVerified, setConnectionsVerified] = useState(false);
  const [selectedConnectionIds,setSelectedConnectionIds]=useState<string[]>([]);
  useEffect(()=>{setSelectedConnectionIds([]);},[brand.workspaceId,activeBusinessId]);
  useEffect(()=>{if(connectionsVerified)setSelectedConnectionIds(previous=>previous.filter(id=>activeBusiness.connectionIds.includes(id)&&connections.some(account=>account.connectionId===id&&account.connected)));},[connections,connectionsVerified,activeBusinessId,activeBusiness.connectionIds.join(',')]);
  const [metaAccount, setMetaAccount] = useState<MetaAdsAccountConnection>(INITIAL_META_ADS_ACCOUNT);
  const [workspaceAssets, setWorkspaceAssets] = useState<BrandVaultAsset[]>([]);
  const vaultAssets=workspaceAssets.filter(asset=>assetBusiness(asset)===activeBusinessId);
  const activeConnections=businessAccounts(activeBusiness,connections);
  const [autonomyConfig, setAutonomyConfig] = useState<AutonomyConfig>(INITIAL_AUTONOMY_CONFIG);
  const [eventCampaigns, setEventCampaigns] = useState<EventCampaign[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [contentHistoryReady, setContentHistoryReady] = useState(false);
  const [metaAdCampaigns, setMetaAdCampaigns] = useState<MetaAdCampaignPlan[]>([]);

  // Studio form state
  const [studioSourceMode,setStudioSourceMode]=useState<ContentSourceMode>('manual');
  const [studioOfferingIds,setStudioOfferingIds]=useState<string[]>([]);
  const [studioContentIntent,setStudioContentIntent]=useState<ContentIntent>('auto');
  const [studioFormat, setStudioFormat] = useState<ContentFormat>('single_post');
  const [isCreatingContent, setIsCreatingContent] = useState(false);
  const [generationQuota, setGenerationQuota] = useState<GenerationQuota | null>(null);
  const [generationFeedback, setGenerationFeedback] = useState<GenerationFeedback | null>(null);
  const generationAttempt = useRef<object | null>(null);
  const hydrationEpoch = useRef(0);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null);
  const [publishReviewDraftId, setPublishReviewDraftId] = useState<string | null>(null);
  const [reviewOAuthAccounts, setReviewOAuthAccounts] = useState(false);
  const [startAddingSocialAccount, setStartAddingSocialAccount] = useState(false);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [referenceInstruction, setReferenceInstruction] = useState('');
  const [referenceRoles, setReferenceRoles] = useState<ContentReferenceRoles>({});
  useEffect(() => { setSelectedReferenceIds([]); setReferenceRoles({}); setReferenceInstruction('');setStudioTopic('');setStudioSourceMode('manual');setStudioOfferingIds([]);setStudioContentIntent('auto');setProfileDirty(false);setProfileBusy(false);setAdsSourceDraft(undefined);setPublishReviewDraftId(null);setGenerationFeedback(null); }, [brand.workspaceId,activeBusinessId]);
  const [studioTopic, setStudioTopic] = useState<string>('');
  useEffect(()=>{setStudioOfferingIds(previous=>previous.filter(id=>brand.offerings.some(item=>item.id===id)));},[brand.offerings]);
  const [studioFilter, setStudioFilter] = useState<'all' | 'draft' | 'published' | 'attention'>('all');
  const studioCollectionHeading = useRef<HTMLHeadingElement>(null);
  const focusStudioCollection = useRef(false);
  useEffect(() => {
    if (activeTab !== 'studio' || !focusStudioCollection.current) return;
    focusStudioCollection.current = false;
    studioCollectionHeading.current?.focus();
  }, [activeTab]);

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
  const [firebaseCfg, setFirebaseCfg] = useState<VeloxaFirebaseConnectionConfig>(() =>
    getDefaultFirebaseConnectionConfig(),
  );
  const [, setLocalTelemetry] = useState<LocalFirstTelemetry>(() =>
    getInitialLocalFirstTelemetry(),
  );
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
  useEffect(() => { generationAttempt.current = null; setIsCreatingContent(false); setGenerationFeedback(null); setGenerationQuota(null); }, [authUser?.uid, brand.workspaceId]);

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
      setWorkspaceBrand(snap.brand);setActiveBusinessId(PRIMARY_BUSINESS);setBusinessesReady(false);setBusinesses([]);
      setActivePlanId(snap.activePlanId);
      setPostsUsedThisMonth(snap.postsUsedThisMonth);
      setConnections(snap.connections);
      setMetaAccount({ ...snap.metaAccount, connected: false });
      setWorkspaceAssets(snap.vaultAssets);
      setAutonomyConfig({ ...snap.autonomyConfig, enabled: false });
      setEventCampaigns(snap.eventCampaigns);
      setDrafts(snap.drafts);
      setMetaAdCampaigns(snap.metaAdCampaigns);

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

      const [metaResult, contentResult, mediaResult,businessResult] = await Promise.allSettled([
        veloxaApi<{ connections: ChannelConnectionState[] }>(`/api/veloxa/meta/accounts?workspaceId=${encodeURIComponent(targetWsId)}`),
        veloxaApi<{ drafts: ContentDraft[]; quotaUsed: number; publicationQuota?: PublicationQuota; generationQuota?: GenerationQuota }>(`/api/veloxa/content?workspaceId=${encodeURIComponent(targetWsId)}`),
        veloxaApi<{ assets: BrandVaultAsset[] }>(`/api/veloxa/media?workspaceId=${encodeURIComponent(targetWsId)}&includeTrash=1`),
        veloxaApi<{businesses:BusinessContext[]}>(`/api/veloxa/businesses?workspaceId=${encodeURIComponent(targetWsId)}`),
      ]);
      if (epoch !== hydrationEpoch.current) return;
      const resourceIssues: string[] = [];
      if (metaResult.status === 'fulfilled') {
        const meta = metaResult.value;
        setConnectionsVerified(true);
        setConnections(withConnectionPlaceholders(meta.connections,INITIAL_CHANNEL_CONNECTIONS));
      } else {
        // Keep the last known account metadata. A failed check is not a disconnect.
        setConnectionsVerified(false);
        resourceIssues.push('Status akun sosial belum dapat diperiksa. Muat ulang halaman untuk mencoba lagi.');
      }
      if (contentResult.status === 'fulfilled') {
        const content = contentResult.value;
        setDrafts(previous => [...content.drafts, ...previous.filter(draft => !content.drafts.some(item => item.id === draft.id)).map(draft => draft.renderedMedia ? draft : { ...draft, status: 'draft' as const, publishedAtWib: undefined, channelStatuses: draft.channelStatuses.map(item => ({ channel: item.channel, status: 'pending' as const })) })]);
        setPostsUsedThisMonth(content.quotaUsed); setPublicationQuota(content.publicationQuota ?? null); setGenerationQuota(content.generationQuota || null);
        setContentHistoryReady(true);
      } else resourceIssues.push('Koleksi konten belum dapat diperbarui.');
      if (businessResult.status==='fulfilled'){setBusinesses(businessResult.value.businesses);try{const saved=sessionStorage.getItem(`veloxa:business:${user.uid}:${targetWsId}`);if(saved&&businessResult.value.businesses.some(item=>item.id===saved))setActiveBusinessId(saved);}catch{ /* Storage is optional. */ }setBusinessesReady(true);setBusinessError('');}else{setBusinessesReady(false);setBusinessError('Daftar bisnis belum dapat dimuat.');resourceIssues.push('Muat ulang daftar bisnis sebelum membuat konten.');}
      if (mediaResult.status === 'fulfilled') setWorkspaceAssets(previous=>[...previous.filter(asset=>assetBusiness(asset)!==PRIMARY_BUSINESS),...mediaResult.value.assets]);
      else {
        setWorkspaceAssets([]); setSelectedReferenceIds([]);
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

    };

    const pendingReg = consumePendingRegistrationBrand();

    if (pendingReg) {
      setStatusBanner(
        'Profil bisnis sudah tersimpan. Selamat datang di Veloxa!',
      );
    }

    let active = true;
    const unsubAuth = subscribeToFirebaseAuthChanges((fbUser) => {
      if (!active) return;
      const epoch = ++hydrationEpoch.current;
      setIsWorkspaceLoading(!!fbUser);
      setAuthUser(fbUser);setBusinessesReady(false);setBusinesses([]);setActiveBusinessId(PRIMARY_BUSINESS);setProfileDirty(false);setProfileBusy(false);
      setContentHistoryReady(false);
      setPublicationQuota(null);
      setGenerationQuota(null);
      setManagingBusiness(false);
      setActiveRole(fbUser?.isSuperAdmin ? 'admin' : 'user');
      if (fbUser) void hydrateForAuthenticatedUser(fbUser, epoch).catch(error => {
        if (active && epoch === hydrationEpoch.current) setStatusBanner('Workspace belum dapat dimuat.');
      }).finally(() => { if (active && epoch === hydrationEpoch.current) setIsWorkspaceLoading(false); });
      else hasHydratedCloudWorkspaceRef.current = null;
    }, () => setStatusBanner('Sesi belum dapat diverifikasi.'));

    return () => { active = false; hydrationEpoch.current++; unsubAuth(); };
  }, [router]);

  useEffect(() => {
    if (!authUser || hasHydratedCloudWorkspaceRef.current !== brand.workspaceId) {
      return;
    }
    void syncWorkspaceSnapshotToStore(
      {
        brand:workspaceBrand,
        activePlanId,
        postsUsedThisMonth,
        connections,
        metaAccount,
        vaultAssets:workspaceAssets,
        autonomyConfig,
        eventCampaigns,
        drafts,
        metaAdCampaigns,
        tenants: [],
        updatedAtIso: new Date().toISOString(),
      },
      firebaseCfg,
      { forceCloudPush: true },
    ).then((res) => {
      setLocalTelemetry(res.telemetry);
      if(res.conflict) setStatusBanner('Perubahan belum tersinkron. Periksa koneksi, lalu coba lagi.');
    });
  }, [
    authUser,
    workspaceBrand,
    activePlanId,
    postsUsedThisMonth,
    connections,
    metaAccount,
    workspaceAssets,
    autonomyConfig,
    eventCampaigns,
    drafts,
    metaAdCampaigns,
    firebaseCfg,
  ]);

  const currentPlan = SUBSCRIPTION_PLANS[activePlanId];

  const handleForceCloudSync = async () => {
    const res = await syncWorkspaceSnapshotToStore(
      {
        brand:workspaceBrand,
        activePlanId,
        postsUsedThisMonth,
        connections,
        metaAccount,
        vaultAssets:workspaceAssets,
        autonomyConfig,
        eventCampaigns,
        drafts,
        metaAdCampaigns,
        tenants: [],
        updatedAtIso: new Date().toISOString(),
      },
      firebaseCfg,
      { forceCloudPush: true },
    );
    setLocalTelemetry(res.telemetry);
    setStatusBanner(
      res.syncedToFirestore
        ? 'Data berhasil disinkronkan.'
        : 'Perubahan belum tersinkron. Periksa koneksi, lalu coba lagi.',
    );
  };

  const handleCompleteNewBusinessOnboarding = (e: React.FormEvent) => {
    e.preventDefault();
    onboardingDialogRef.current?.close();
    router.push(authUser ? '/onboarding' : '/register');
  };

  const navigateWorkspace=(tab:UserTabId)=>{if(profileDirty&&['brand_vault','autonomy'].includes(activeTab)&&tab!==activeTab){setStatusBanner('Simpan atau batalkan perubahan sebelum berpindah halaman.');return;}setActiveTab(tab);};
  const openStudioWithFormat = (format: ContentFormat) => {
    setStudioFormat(format);
    setStudioFilter('all');
    navigateWorkspace('studio');
  };
  const businessLocked=isWorkspaceLoading||isCreatingContent||Boolean(publishingDraftId)||businessSaving||profileDirty||profileBusy;
  const selectBusiness=(id:string)=>{if(businessLocked||!businessesReady||!businesses.some(item=>item.id===id))return;hydrationEpoch.current++;try{sessionStorage.setItem(`veloxa:business:${authUser?.uid}:${workspaceBrand.workspaceId}`,id);}catch{ /* Storage is optional. */ }setActiveBusinessId(id);setStatusBanner('');};
  const reloadBusinesses=async()=>{const epoch=hydrationEpoch.current;const result=await veloxaApi<{businesses:BusinessContext[]}>(`/api/veloxa/businesses?workspaceId=${encodeURIComponent(workspaceBrand.workspaceId)}`);if(epoch!==hydrationEpoch.current)return;setBusinesses(result.businesses);setBusinessesReady(true);setBusinessError('');};
  const saveBusinessChanges=async(patch:{connectionIds?:string[];profile?:BrandProfile;schedule?:BusinessSchedule;expectedProfileFingerprint?:string})=>{
    if(!businessesReady)throw new Error('Muat ulang daftar bisnis terlebih dahulu.');const epoch=hydrationEpoch.current;setBusinessSaving(true);
    try{const result=await veloxaApi<{businesses:BusinessContext[];workspaceSnapshotRevision?:number}>('/api/veloxa/businesses',{method:'PATCH',body:JSON.stringify({workspaceId:workspaceBrand.workspaceId,businessId:activeBusinessId,expectedRevision:activeBusiness.revision,...patch})});if(epoch!==hydrationEpoch.current)throw new Error('Bisnis telah berubah. Muat ulang untuk memeriksa hasil.');if(patch.profile&&activeBusinessId===PRIMARY_BUSINESS){if(result.workspaceSnapshotRevision===undefined)throw new Error('Revisi profil utama belum dapat diverifikasi. Muat ulang halaman.');acceptServerWorkspaceRevision(workspaceBrand.workspaceId,result.workspaceSnapshotRevision);setWorkspaceBrand(result.businesses.find(item=>item.id===PRIMARY_BUSINESS)!.brand);}setBusinesses(result.businesses);}finally{setBusinessSaving(false);}
  };
  const createNewBusiness=async(name:string)=>{const epoch=hydrationEpoch.current;setBusinessSaving(true);try{const result=await veloxaApi<{businesses:BusinessContext[];businessId:string}>('/api/veloxa/businesses',{method:'POST',body:JSON.stringify({workspaceId:workspaceBrand.workspaceId,name})});if(epoch!==hydrationEpoch.current)return;setBusinesses(result.businesses);hydrationEpoch.current++;try{sessionStorage.setItem(`veloxa:business:${authUser?.uid}:${workspaceBrand.workspaceId}`,result.businessId);}catch{ /* Storage is optional. */ }setActiveBusinessId(result.businessId);setActiveTab('brand_vault');setStatusBanner('Bisnis dibuat. Lengkapi profil dan tautkan akun sosial yang sesuai.');}finally{setBusinessSaving(false);}};
  const handleSaveBrandProfile=async(value:BrandProfile)=>{if(!businessesReady||value.workspaceId!==workspaceBrand.workspaceId||(value.businessId||PRIMARY_BUSINESS)!==activeBusinessId)throw new Error('Bisnis berubah. Buka kembali profil yang ingin disimpan.');const epoch=hydrationEpoch.current;const expectedProfileFingerprint=activeBusinessId===PRIMARY_BUSINESS?await profileFingerprint(workspaceBrand):undefined;if(epoch!==hydrationEpoch.current)throw new Error('Bisnis berubah.');await saveBusinessChanges({profile:normalizeBrandProfile(value),...(expectedProfileFingerprint?{expectedProfileFingerprint}:{})});};
  const handleReloadBrandPhotos = async () => {
    const epoch=hydrationEpoch.current;const id=activeBusinessId;
    const result=await veloxaApi<{assets:BrandVaultAsset[]}>(`/api/veloxa/media?workspaceId=${encodeURIComponent(workspaceBrand.workspaceId)}&businessId=${encodeURIComponent(id)}&includeTrash=1`);
    if(epoch!==hydrationEpoch.current)throw new Error('Bisnis berubah. Buka kembali galeri foto.');
    setWorkspaceAssets(previous=>[...previous.filter(asset=>assetBusiness(asset)!==id),...result.assets]);setSelectedReferenceIds(previous=>previous.filter(key=>result.assets.some(asset=>asset.id===key&&!asset.trashedAt)));
  };
  const handleUploadBrandPhoto = async (file: File, title: string,kind?:import('@/lib/asset-kind').AssetKindMetadata) => {
    if(!businessesReady)throw new Error('Daftar bisnis belum tersedia.');const epoch=hydrationEpoch.current;
    const form=new FormData();form.set('workspaceId',workspaceBrand.workspaceId);form.set('businessId',activeBusinessId);form.set('file',file);form.set('title',title);if(kind){form.set('category',kind.category);form.set('customCategoryLabel',kind.customCategoryLabel);}
    const result=await veloxaApi<{asset:BrandVaultAsset}>('/api/veloxa/media',{method:'POST',body:form});
    if(epoch!==hydrationEpoch.current)throw new Error('Bisnis berubah. Buka kembali galeri foto.');setWorkspaceAssets(previous=>[result.asset,...previous.filter(asset=>asset.id!==result.asset.id)]);return result.asset;
  };
  const handleAssetMetadata=async(asset:BrandVaultAsset,kind:import('@/lib/asset-kind').AssetKindMetadata)=>{const epoch=hydrationEpoch.current;const result=await veloxaApi<{asset:BrandVaultAsset}>('/api/veloxa/media/category',{method:'PATCH',body:JSON.stringify({workspaceId:workspaceBrand.workspaceId,businessId:activeBusinessId,assetId:asset.id,expectedRevision:asset.metadataRevision||0,...kind})});if(epoch!==hydrationEpoch.current)throw new Error('Bisnis berubah. Buka kembali galeri.');setWorkspaceAssets(previous=>previous.map(item=>item.id===asset.id?result.asset:item));return result.asset;};
  const handleAssetState = async (assetId:string,action:'trash'|'restore')=>{const epoch=hydrationEpoch.current;const result=await veloxaApi<{asset:BrandVaultAsset}>('/api/veloxa/media',{method:'PATCH',body:JSON.stringify({workspaceId:workspaceBrand.workspaceId,businessId:activeBusinessId,assetId,action})});if(epoch!==hydrationEpoch.current)throw new Error('Bisnis berubah. Buka kembali galeri.');setWorkspaceAssets(previous=>previous.map(asset=>asset.id===assetId?result.asset:asset));if(action==='trash')setSelectedReferenceIds(previous=>previous.filter(id=>id!==assetId));};
  useEffect(()=>{let active=true;const epoch=hydrationEpoch.current;if(authUser&&businessesReady)void handleReloadBrandPhotos().catch(error=>{if(active&&epoch===hydrationEpoch.current)setStatusBanner('Galeri foto belum dapat dimuat. Coba Muat ulang di Profil & aset.');});return()=>{active=false;};},[authUser?.uid,activeBusinessId,businessesReady]);

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


  const handleToggleChannel = (channel: SocialChannelId) => handleOpenOAuthConfigModal(channel);

  const handleGenerateStudioDraft = async (_source: ContentDraft['source'] = 'manual_studio', scheduledSlotWib?: string, resumePrevious=false, carouselPlan?:CarouselPlan) => {
    if (generationAttempt.current || businessSaving) return;
    if(!businessesReady||!resumePrevious&&(!selectedConnectionIds.length||selectedConnectionIds.some(id=>!activeBusiness.connectionIds.includes(id)))){setStatusBanner('Pilih bisnis dan tautkan akun tujuan yang sesuai sebelum membuat konten.');return;}
    if(!resumePrevious&&studioSourceMode==='offerings'&&(!studioOfferingIds.length||studioOfferingIds.some(id=>!brand.offerings.some(item=>item.id===id)))){setStatusBanner('Centang produk milik bisnis aktif sebelum membuat konten.');return;}
    if (scheduledSlotWib) { setStatusBanner('Penjadwalan belum diaktifkan. Buat dan tinjau post tunggal di Studio dahulu.'); return; }
    const attempt = {}; generationAttempt.current = attempt;
    const epoch = hydrationEpoch.current;
    const current = () => generationAttempt.current === attempt && hydrationEpoch.current === epoch;
    let stage: GenerationStage = 'validation';
    let requestStarted=false;let recovering=false;
    setIsCreatingContent(true); setGenerationFeedback({ status: 'running', stage });
    setStudioFilter('all');
    try {
      const expectedProfileFingerprint = await profileFingerprint(brand);
      if (!current()) return;
      stage = 'validation'; setGenerationFeedback({ status: 'running', stage });
      requestStarted=true;
      const result = await createVeloxaContent<{ draft: ContentDraft; engineMode: string; generationQuota?: GenerationQuota }>({ workspaceId: brand.workspaceId, businessId:activeBusinessId, sourceMode:studioSourceMode,...(studioSourceMode==='offerings'?{offeringIds:studioOfferingIds,contentIntent:studioContentIntent}:{}), selectedConnectionIds, topic: studioTopic.trim(), expectedProfileFingerprint, format: studioFormat, referenceAssetIds: selectedReferenceIds, referenceRoles:Object.fromEntries(selectedReferenceIds.map(id=>[id,referenceRoles[id]||'visual'])), ...(selectedReferenceIds.length || studioFormat==='carousel' ? { referenceInstruction: referenceInstruction.trim() } : {}), ...(carouselPlan ? {carouselPlan} : {}) }, { resumePrevious, onRecover:()=>{recovering=true;if(current())setGenerationFeedback({status:'running',stage,message:'Koneksi terputus. Memeriksa hasil percobaan yang sama di server; tidak membuat ulang.'});}, onProgress: progress => { if (current()) { stage = progress.stage; setGenerationFeedback({ status: 'running', stage,...(recovering?{message:'Memeriksa hasil percobaan yang sama di server; tidak menjalankan generasi baru.'}:{}) }); } } });
      if (!current()) return;
      setDrafts(previous => [result.draft, ...previous.filter(item=>item.id!==result.draft.id)]); if(!resumePrevious&&!carouselPlan)setStudioTopic(''); setGenerationQuota(result.generationQuota || null);
      setGenerationFeedback({ status: 'success', stage: 'saving', message: resumePrevious?'Hasil percobaan sebelumnya berhasil diambil. Topik baru Anda tetap tersedia; belum ada konten diterbitkan.':'Draf berhasil dibuat. Tinjau hasilnya pada koleksi konten di bawah. Belum ada konten diterbitkan.' });
      setStatusBanner(`Draf dan media final siap ditinjau. ${result.engineMode === 'openai_live' ? 'Caption disusun dengan AI.' : 'Caption memakai template lokal; AI belum tersedia.'} Belum ada konten diterbitkan.`);
    } catch (error) {
      if (current()) setGenerationFeedback({ status: 'error', stage: error instanceof ContentGenerationError && error.stage ? error.stage : stage, message: error instanceof Error ? error.message : 'Konten belum dapat dibuat. Silakan coba lagi.', requestId: error instanceof ContentGenerationError ? error.requestId : undefined, uncertain: error instanceof ContentGenerationError ? error.uncertain : requestStarted });
    } finally { if (generationAttempt.current === attempt) { if (!current()) setGenerationFeedback(null); generationAttempt.current = null; setIsCreatingContent(false); } }
  };
  const handlePublishDraftNow = async (draftId: string) => {
    if (!publishingDraftId && drafts.some(draft => draft.id === draftId)) setPublishReviewDraftId(draftId);
  };
  const confirmPublishDraftNow = async (draftId: string) => {
    const draft = drafts.find(item => item.id === draftId);
    if (!draft || publishingDraftId) return;
    const publishEpoch=hydrationEpoch.current;
    setPublishReviewDraftId(null);
    setPublishingDraftId(draftId); setStatusBanner('Mengirim konten ke Meta. Jangan menutup halaman selama proses berlangsung…');
    try {
      setGenerationFeedback(null);
      for(let batch=0;batch<50;batch++){
        if(hydrationEpoch.current!==publishEpoch)return;
        const result = await veloxaApi<{ draft: ContentDraft; receipts: { channel:string; handle?:string; accountName?:string; status:string; error?:string }[]; quotaUsed?:number; publicationQuota?:PublicationQuota; hasMore?:boolean; pendingAccounts?:number }>('/api/veloxa/publish',{method:'POST',body:JSON.stringify({workspaceId:brand.workspaceId,draftId})});
        if(hydrationEpoch.current!==publishEpoch)return;
        setDrafts(previous=>previous.map(item=>item.id===draftId?result.draft:item));
        if(result.quotaUsed!==undefined)setPostsUsedThisMonth(result.quotaUsed);
        if(result.publicationQuota)setPublicationQuota(result.publicationQuota);
        if(result.hasMore){setStatusBanner(`Publikasi diproses: ${result.receipts.length} akun diperiksa · ${result.pendingAccounts} akun menunggu. Jangan menutup halaman…`);continue;}
        setStatusBanner(result.receipts.map(receipt=>`${receipt.channel} ${receipt.channel==='facebook'?receipt.accountName||receipt.handle||'':receipt.handle||receipt.accountName||''}: ${receipt.status==='published'?'berhasil diterbitkan':receipt.error||'belum berhasil'}`).join(' · '));break;
      }
    } catch (error) { if(hydrationEpoch.current!==publishEpoch)return;setStatusBanner(error instanceof Error ? error.message : 'Publikasi belum dapat dipastikan. Periksa akun Meta sebelum mencoba ulang.'); }
    finally { setPublishingDraftId(null); }
  };

  const handleSaveBusinessEvent=async(name:string,date:string,highlight:string,connectionIds:string[])=>{
    if(!businessesReady||!name.trim()||name.trim().length>120||highlight.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||!connectionIds.length||connectionIds.some(id=>!activeBusiness.connectionIds.includes(id)))throw new Error('Periksa nama, tanggal, dan akun rencana event.');
    const epoch=hydrationEpoch.current;const created:EventCampaign={id:'camp_'+crypto.randomUUID(),workspaceId:workspaceBrand.workspaceId,businessId:activeBusinessId,connectionIds:[...new Set(connectionIds)],name:name.trim(),eventDateIso:date,location:brand.city,ticketOrPromoHighlight:highlight.trim(),targetRegistrationsOrSales:0,currentConversions:0,status:'Scheduled',currentPhase:computeEventCampaignPhase(date).phase,autoInjectIntoDailyAutonomy:false};const next=[created,...eventCampaigns];setBusinessSaving(true);
    try{const result=await syncWorkspaceSnapshotToStore({brand:workspaceBrand,activePlanId,postsUsedThisMonth,connections,metaAccount,vaultAssets:workspaceAssets,autonomyConfig,eventCampaigns:next,drafts,metaAdCampaigns,tenants:[],updatedAtIso:new Date().toISOString()},firebaseCfg,{forceCloudPush:true});if(!result.syncedToFirestore)throw new Error('Rencana event belum tersimpan.');if(epoch!==hydrationEpoch.current)throw new Error('Bisnis telah berubah.');setEventCampaigns(next);}finally{setBusinessSaving(false);}
  };

  const handleDesignMetaAdsWithAi=(draft?:ContentDraft)=>{if(draft&&draftBusiness(draft)!==activeBusinessId){setStatusBanner('Pilih bisnis asal konten sebelum merancang iklan.');return;}setAdsSourceDraft(draft);setActiveTab('meta_ads');};
  const handleSaveBusinessAdPlan=async(plan:MetaAdCampaignPlan)=>{
    if(!businessesReady||plan.businessId!==activeBusinessId||!plan.destinationAccounts?.length||plan.destinationAccounts.some(target=>!activeBusiness.connectionIds.includes(target.connectionId)))throw new Error('Rancangan dan akun tujuan tidak sesuai bisnis aktif.');
    const epoch=hydrationEpoch.current;const next=[plan,...metaAdCampaigns];setBusinessSaving(true);try{const result=await syncWorkspaceSnapshotToStore({brand:workspaceBrand,activePlanId,postsUsedThisMonth,connections,metaAccount,vaultAssets:workspaceAssets,autonomyConfig,eventCampaigns,drafts,metaAdCampaigns:next,tenants:[],updatedAtIso:new Date().toISOString()},firebaseCfg,{forceCloudPush:true});if(!result.syncedToFirestore)throw new Error('Rancangan belum tersimpan.');if(epoch!==hydrationEpoch.current)throw new Error('Bisnis telah berubah.');setMetaAdCampaigns(next);setLocalTelemetry(result.telemetry);}finally{setBusinessSaving(false);}
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
    setStatusBanner('Konfigurasi produksi dikelola melalui environment dan Secret Manager backend. Kunci API tidak disimpan di browser.');
  };

  const businessDrafts=drafts.filter(draft=>draftBusiness(draft)===activeBusinessId);
  const businessAdPlans=metaAdCampaigns.filter(plan=>(plan.businessId||PRIMARY_BUSINESS)===activeBusinessId);
  const studioDrafts = businessDrafts.filter(draft => studioFilter === 'all' || (studioFilter === 'published' ? draft.status === 'published' : studioFilter === 'attention' ? ['publish_failed', 'partially_published', 'needs_attention'].includes(draft.status) : !['published', 'publish_failed', 'partially_published', 'needs_attention'].includes(draft.status)));
  const organicWinnerDraft = businessDrafts.find((d) => d.organicMetrics?.isOrganicWinner);
  const t = workspaceTranslator(locale, workspaceCatalog);
  const workspaceLanguage = VELOXA_LOCALES.find(item => item.code === locale)!;

  const isUserWorkspaceView = Boolean(
    authUser && !(authUser.isSuperAdmin && activeRole === 'admin'),
  );

  return (
    <WorkspaceLanguage locale={locale}>
    <div
      lang={isUserWorkspaceView ? locale : undefined}
      dir={isUserWorkspaceView ? workspaceLanguage.dir : undefined}
      className={`min-h-dvh text-neutral-900 ${
        isUserWorkspaceView ? `pb-24 lg:pb-0 ${workspaceStyles.frame}` : authUser ? 'pb-12 bg-[#f8f5f7]' : 'bg-[#fbf7f2]'
      }`}
    >
      {authUser && isWorkspaceLoading && <div className="fixed inset-0 z-[100] grid place-items-center bg-white" role="status" aria-live="polite"><div className="text-center"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-pink-100 border-t-[#D85A88]" /><p className="font-medium text-neutral-800">{t('Menyiapkan workspace Anda…')}</p></div></div>}
      {!isUserWorkspaceView && (
        <header
          className={`sticky top-0 z-30 border-b backdrop-blur ${authUser
            ? 'border-[#e9dfe5] bg-white/95 text-neutral-900'
            : 'border-[#eab1d026] bg-[#180f1c]/95'}`}
        >
          {!authUser ? <VeloxaPublicHeader locale={locale} onLocale={handleSelectLocale} /> : (
            <div lang="id" dir="ltr" className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-2 px-3.5 py-3 sm:px-8">
              <div className="flex shrink-0 items-center gap-2">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#682943] font-semibold text-white" aria-hidden="true">V</div>
                <span className="text-base font-semibold">Veloxa <span className="block text-xs font-medium text-[#682943] sm:inline">Super Admin</span></span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" data-testid="open-own-workspace-btn" onClick={() => setActiveRole('user')}
                  className="min-h-11 rounded-lg border border-[#e9dfe5] bg-white px-3 text-sm font-semibold text-[#682943] hover:bg-[#fbf1f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#682943]">
                  Workspace saya
                </button>
                <button type="button" data-testid="logout-btn" onClick={handleRequestSignOutClick}
                  className="min-h-11 rounded-lg border border-[#e9dfe5] bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-[#fbf1f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#682943]">
                  Keluar
                </button>
              </div>
            </div>
          )}
        </header>
      )}

      {/* Main Content Container — Flush Full-Width untuk User Sidemenu, atau 1480px untuk Landing/Super Admin */}
      <main
        className={
          authUser?.isSuperAdmin && activeRole === 'admin'
            ? 'mx-auto max-w-[1480px] px-4 py-6 sm:px-8 lg:px-12'
            : 'w-full'
        }
      >
        <div>
          {!authUser ? (
            /* ======================================================================
               KONDISI 1 (BELUM LOGIN): ULTRA-LUXURY GLOBAL MULTI-LANGUAGE LANDING PAGE
               ====================================================================== */
            <VeloxaPublicLanding locale={locale} />
          ) : authUser.isSuperAdmin && activeRole === 'admin' ? (
            <VeloxaSuperAdmin />
          ) : (
            /* ======================================================================
               ROLE 2: LUXURY EXECUTIVE USER WORKSPACE DASHBOARD
               (FULL-HEIGHT SOLID PINK LEFT SIDEBAR FROM TOP TO BOTTOM + RIGHT HEADER)
               ====================================================================== */
            <VeloxaWorkspaceShell
              activeTab={activeTab} brandName={brand.businessName} planName={currentPlan.name}
              email={authUser.email}
              used={postsUsedThisMonth} quota={publicationQuota?.limit ?? currentPlan.monthlyPostQuota} locale={locale}
              onNavigate={navigateWorkspace} onCreate={() => navigateWorkspace('studio')}
              onConnections={() => handleOpenOAuthConfigModal(activeConnections.some(item => item.channel === 'facebook' && item.connected) ? 'facebook' : 'instagram')}
              onBilling={() => { setSelectedCheckoutPlanId(activePlanId); billingDialogRef.current?.showModal(); }}
              onAccount={() => authDialogRef.current?.showModal()} onSignOut={handleRequestSignOutClick}
              onSync={() => void handleForceCloudSync()} onLocale={handleSelectLocale}
              isSuperAdmin={authUser.isSuperAdmin} onAdmin={() => setActiveRole('admin')}
              status={statusBanner === 'Profil bisnis sudah tersimpan. Selamat datang di Veloxa!' && activeTab !== 'overview' ? undefined : statusBanner || undefined}
              onDismissStatus={() => setStatusBanner('')}
            >
              <VeloxaBusinessSwitcher businesses={businesses} activeId={activeBusinessId} accounts={connections} locked={businessLocked} ready={businessesReady} error={businessError} managing={managingBusiness} onManaging={setManagingBusiness} onSelect={selectBusiness} onCreate={createNewBusiness} onAssign={connectionIds=>saveBusinessChanges({connectionIds})} onReload={reloadBusinesses}/>
              {/* ====================================================================
                 TAB 1: EXECUTIVE ANALYTICS OVERVIEW, CHARTS & 4-CHANNEL COMMAND HUB
                 ==================================================================== */}
              {activeTab === 'overview' && (
                <VeloxaWorkspaceOverview
                  brand={brand}
                  postsUsed={postsUsedThisMonth}
                  quota={publicationQuota?.limit ?? currentPlan.monthlyPostQuota}
                  dailyPublicationQuota={publicationQuota && publicationQuota.dailyLimit !== null ? { used: publicationQuota.dailyUsed, limit: publicationQuota.dailyLimit } : undefined}
                  connections={activeConnections}
                  connectionsVerified={connectionsVerified && businessesReady}
                  drafts={businessDrafts}
                  onEditProfile={() => navigateWorkspace('brand_vault')}
                  onStudio={() => navigateWorkspace('studio')}
                  onCreateContent={openStudioWithFormat}
                  onConnections={() => handleOpenOAuthConfigModal(activeConnections.some(item => item.channel === 'facebook' && item.connected) ? 'facebook' : 'instagram')}
                  firstPost={{
                    historyReady: contentHistoryReady,
                    canAssignAccount: connections.some(account => isPublishingAccount(account) &&
                      !businesses.some(business => business.connectionIds.includes(account.connectionId!))),
                    disabled: businessLocked,
                    onConnect: () => {
                      setStartAddingSocialAccount(true);
                      handleOpenOAuthConfigModal('instagram');
                    },
                    onAssign: () => setManagingBusiness(true),
                    onCollection: () => {
                      setStudioFilter('all');
                      focusStudioCollection.current = true;
                      navigateWorkspace('studio');
                    },
                    onReview: handlePublishDraftNow,
                  }}
                />
              )}

              {/* ====================================================================
                 TAB 2: BRAND BRAIN & DUAL ASSET VAULT (REFERENSI GAYA vs FOTO ASLI)
                 ==================================================================== */}
              {activeTab === 'brand_vault' && (
                <VeloxaBrandWorkspace key={brand.workspaceId+':'+activeBusinessId} onDirtyChange={setProfileDirty} onBusyChange={setProfileBusy} brand={brand} accounts={activeConnections} accountsReady={connectionsVerified&&businessesReady} assets={vaultAssets} onSave={handleSaveBrandProfile} onUpload={handleUploadBrandPhoto} onMetadata={handleAssetMetadata} onAssetState={handleAssetState} onReload={handleReloadBrandPhotos}
                  onFirstDraft={contentHistoryReady && !businessDrafts.length && connectionsVerified && businessesReady && activeConnections.some(isPublishingAccount)
                    ? () => openStudioWithFormat('single_post') : undefined}
                />
              )}

              {/* ====================================================================
                 TAB 3: STUDIO KONTEN MULTI-PLATFORM (IG, FB, TIKTOK, YOUTUBE SHORTS)
                 ==================================================================== */}
              {activeTab === 'studio' && (
                <div className="space-y-6">
                  <VeloxaStudioComposer key={`${brand.workspaceId}:${activeBusinessId}`} brand={brand} onAssistantBusyChange={setBusinessSaving} onResume={()=>void handleGenerateStudioDraft('manual_studio',undefined,true)} sourceMode={studioSourceMode} onSourceMode={setStudioSourceMode} offerings={brand.offerings} offeringIds={studioOfferingIds} onOfferings={setStudioOfferingIds} contentIntent={studioContentIntent} onIntent={setStudioContentIntent} accounts={activeConnections} accountsVerified={connectionsVerified&&businessesReady} selectedConnectionIds={selectedConnectionIds} onAccounts={setSelectedConnectionIds} brandName={brand.businessName} format={studioFormat} topic={studioTopic} assetIds={selectedReferenceIds} referenceRoles={referenceRoles} onRole={(id,role)=>setReferenceRoles(previous=>({...previous,[id]:role}))} referenceInstruction={referenceInstruction} assets={vaultAssets} creating={isCreatingContent} feedback={generationFeedback} quota={generationQuota} onFormat={setStudioFormat} onTopic={setStudioTopic} onAssets={setSelectedReferenceIds} onInstruction={setReferenceInstruction} onManageAssets={() => setActiveTab('brand_vault')} onCreate={plan => void handleGenerateStudioDraft('manual_studio',undefined,false,plan)} />

                  <div className="flex flex-wrap items-center justify-between gap-4"><h2 ref={studioCollectionHeading} tabIndex={-1} className="text-xl font-semibold">{t("Koleksi konten")} <span className="ml-1 text-base font-normal text-neutral-400">{businessDrafts.length}</span></h2><div role="group" aria-label={t("Filter konten")} className="flex max-w-full flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-1">{([{id:'all',label:'Semua'},{id:'draft',label:'Draf'},{id:'published',label:'Terbit'},{id:'attention',label:'Perlu perhatian'}] as const).map(item => <button type="button" key={item.id} aria-pressed={studioFilter === item.id} onClick={() => setStudioFilter(item.id)} className={`rounded-md px-3 py-2 text-sm ${studioFilter === item.id ? 'bg-neutral-100 font-medium text-neutral-950' : 'text-neutral-500 hover:text-neutral-900'}`}>{t(item.label)}</button>)}</div></div>
                  {studioDrafts.length === 0 && <div className="veloxa-panel px-6 py-12 text-center"><p className="text-lg font-medium">{businessDrafts.length ? t("Belum ada konten pada filter ini.") : t("Draf pertama Anda dimulai dari sini.")}</p><p className="mt-2 text-base text-neutral-500">{businessDrafts.length ? t("Pilih filter lain untuk melihat koleksi konten.") : t("Pilih format dan tulis ide pada formulir di atas.")}</p></div>}

                  {/* Generated Drafts List */}
                  <div className="space-y-4">
                    {studioDrafts.map((draft) => (
                      <article
                        key={draft.id}
                        className="veloxa-panel p-4 sm:p-6"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-pink-200 bg-pink-50/70 px-2.5 py-0.5 text-sm font-semibold text-[#a92e5d]">
                                {draft.status === 'published' ? t("✓ Sudah Tayang") : draft.status === 'needs_attention' ? t("Perlu diperiksa di Meta") : draft.status === 'partially_published' ? t("Sebagian kanal berhasil") : draft.status === 'publish_failed' ? t("Publikasi gagal") : draft.status === 'publish_queued' ? t("Publikasi siap dilanjutkan") : draft.status === 'publishing' ? t("Sedang mengirim") : t("Draf — tinjau sebelum terbit")}
                              </span>
                              <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-sm font-medium text-neutral-700">
                                {draft.format === 'short_video'
                                  ? `Video 9:16 (${draft.videoDurationSeconds || 28} dtk)`
                                  : draft.format === 'carousel'
                                    ? `Carousel (${draft.renderedSlides?.length || draft.slides?.length || 0} slide)`
                                    : t("Post Tunggal")}
                              </span>
                              {draft.usedRealAssetIds.length > 0 && (
                                <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-sm font-medium text-neutral-700">{t("Referensi visual:")} {draft.usedRealAssetIds.length} foto
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
                                className="veloxa-button-primary"
                              >
                                <Send className="mr-1.5 inline h-3.5 w-3.5" />
                                {draft.status === 'publish_queued' ? t("Tinjau & lanjutkan publikasi") : draft.status === 'partially_published' ? t("Tinjau akun yang gagal") : t("Tinjau & terbitkan")}
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
                              {draft.format === 'short_video' ? t("Buka Video MP4") : t("Buka gambar")}
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
                                ? t("Hentikan pembacaan teks")
                                : t("Dengarkan caption")}
                            </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDesignMetaAdsWithAi(draft)}
                              className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-pink-200 hover:text-[#a92e5d]"
                            >
                              <Megaphone className="mr-1.5 inline h-3.5 w-3.5 text-[#a92e5d]" />{t("Rancang iklan")} </button>
                          </div>
                        </div>

                        {/* Live Rendered Visual Poster / Carousel Preview + Quality Gate */}
                        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(280px,480px)_minmax(0,1fr)]">
                          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 p-2">
                            <StudioMediaPreview draft={draft} fallbackUrl={buildRenderedVisualSvgDataUrl({ brand, draft, slideIndex: 0 })} />
                          </div>
                          <div className="space-y-3">
                            {draft.contentSource?.mode==='offerings'&&<p className="rounded-lg border border-pink-100 bg-pink-50/50 p-3 text-sm text-neutral-700"><strong>{t("Fokus produk:")}</strong> {draft.contentSource.offeringTitles.join(' · ')}</p>}
                            <details className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600"><summary className="cursor-pointer font-medium text-neutral-800">{t("Pemeriksaan kualitas ·")} {draft.qualityReview.score}/100</summary><p className="mt-3 leading-relaxed">{draft.qualityReview.summary}</p><p className="mt-2">{draft.qualityReview.issues.length} {t("masalah ·")} {draft.qualityReview.repairAttempts} perbaikan</p></details>

                            {/* Multi-Channel Distribution Badges */}
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-medium text-neutral-500">{t("Tujuan publikasi:")}</span>
                              {draft.channelStatuses.map((cs) => (
                                <span
                                  key={cs.connectionId||cs.channel}
                                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHANNEL_META[cs.channel].badgeClass}`}
                                >
                                  {CHANNEL_META[cs.channel].shortLabel} {cs.channel==='facebook'?cs.accountName||cs.handle||'':cs.handle||cs.accountName||''}:{' '}
                                  <span className="text-[#a92e5d]">
                                    {cs.status === 'published' ? t("✓ Sudah Tayang") : cs.status === 'failed' ? t("Gagal dikirim") : cs.status === 'unknown' ? t("Perlu diperiksa") : t("Belum diterbitkan")}
                                    {cs.permalink && <a href={cs.permalink} target="_blank" rel="noopener noreferrer" className="ml-2 underline">{t("Lihat posting ↗")}</a>}
                                    {cs.note && <span className="ml-2 text-red-700">{cs.note}</span>}
                                  </span>
                                </span>
                              ))}
                            </div>
                            <p className="whitespace-pre-line rounded-xl border border-neutral-100 bg-white p-3 text-sm text-neutral-600">
                              <strong className="text-neutral-900">{t("Caption:")}</strong> {[draft.caption, draft.hashtags.join(' ')].filter(Boolean).join('\n\n')}
                            </p>
                          </div>
                        </div>

                        {/* Storyboard / Slides Preview — Clean White Cards */}
                        {draft.videoScenes && (
                          <details className="mt-5 border-t border-neutral-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-neutral-600">{t("Lihat naskah & storyboard")}</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {draft.videoScenes.map((scene) => (
                              <div
                                key={scene.sceneNumber}
                                className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-900"
                              >
                                <div>
                                  <div className="flex items-center justify-between text-xs font-medium text-[#a92e5d]">
                                    <span>{t("ADEGAN")} {scene.sceneNumber}</span>
                                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-600">
                                      {scene.timeRange}
                                    </span>
                                  </div>
                                  <p className="mt-2 font-semibold text-neutral-900">{scene.textOverlay}</p>
                                  <p className="mt-2 text-xs text-neutral-600">
                                    <strong className="text-neutral-800">{t("VO:")}</strong> &ldquo;{scene.voiceover}&rdquo;
                                  </p>
                                </div>
                                <p className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-500">{t("Visual:")} {scene.visualDirection}
                                </p>
                              </div>
                            ))}
                          </div></details>
                        )}

                        {draft.slides && (
                          <details className="mt-5 border-t border-neutral-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-neutral-600">{t("Lihat isi setiap slide")}</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {draft.slides.map((slide) => (
                              <div
                                key={slide.slideNumber}
                                className="rounded-xl border border-neutral-200 bg-white p-4 text-sm"
                              >
                                <div className="flex items-center justify-between font-medium text-[#a92e5d]">
                                  <span>{t("SLIDE 0")}{slide.slideNumber}</span>
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
              {activeTab === 'autonomy' && <VeloxaBusinessSchedule key={activeBusinessId} events={eventCampaigns.filter(event=>(event.businessId||PRIMARY_BUSINESS)===activeBusinessId)} onCreateEvent={handleSaveBusinessEvent} business={{...activeBusiness,brand}} accounts={activeConnections} assets={vaultAssets} drafts={businessDrafts} ready={businessesReady&&connectionsVerified} onBusyChange={setProfileBusy} onDirtyChange={setProfileDirty}/>}

              {/* ====================================================================
                 TAB 5: AI AGENT MARKETING · META ADS ARCHITECT & AUTO-OPTIMIZER
                 ==================================================================== */}
              {activeTab === 'meta_ads' && <VeloxaBusinessAds key={activeBusinessId+':'+(adsSourceDraft?.id||'new')} business={{...activeBusiness,brand}} accounts={activeConnections} source={adsSourceDraft} drafts={drafts.filter(item=>draftBusiness(item)===activeBusinessId)} onBusyChange={setBusinessSaving} plans={businessAdPlans} ready={businessesReady&&connectionsVerified} onSave={handleSaveBusinessAdPlan}/>}
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

        {authUser && activeRole === 'user' && (
          <nav
            aria-label={t('Navigasi utama')}
            data-testid="mobile-workspace-bottom-nav"
            className={`${workspaceStyles.mobileNav} veloxa-native-bottom-nav fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 gap-1 border-t px-2 pt-1.5 backdrop-blur lg:hidden`}
          >
            {WORKSPACE_NAVIGATION.map(({ id, short, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-testid={`mobile-nav-tab-${id}`}
                aria-current={activeTab === id ? 'page' : undefined}
                aria-label={t(label)}
                onClick={() => navigateWorkspace(id)}
                className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 text-[11px] font-semibold leading-tight"
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.75}/>
                <span className="truncate">{t(short)}</span>
              </button>
            ))}
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
              <VeloxaSelect
                id="onboard-category"
                value={onboardCategory}
                onValueChange={(e) => setOnboardCategory(e as BusinessCategory)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 font-medium text-neutral-900"
              >
                <option value="cafe_fnb">Cafe, Resto & F&B</option>
                <option value="running_event">Event Lari / Konser / EO</option>
                <option value="clinic_beauty">Klinik Kecantikan & Kesehatan</option>
                <option value="fashion_retail">Fashion & Retail Lokal</option>
                <option value="custom">Bisnis Kustom Lainnya</option>
              </VeloxaSelect>
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
              <VeloxaSelect
                id="onboard-plan"
                value={onboardPlanId}
                onValueChange={(e) => setOnboardPlanId(e as SubscriptionPlanId)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 font-medium text-neutral-900"
              >
                <option value="starter_500k">Starter (Rp500rb/bln)</option>
                <option value="growth_1000k">Growth (Rp1jt/bln)</option>
                <option value="pro_1500k">Pro + Meta Ads (Rp1,5jt/bln)</option>
              </VeloxaSelect>
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
        onClose={() => { setReviewOAuthAccounts(false); setStartAddingSocialAccount(false); }}
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
              {t("Akun sosial")}
            </span>
            <h2 id="oauth-dialog-title" className="mt-1.5 text-lg font-semibold text-neutral-900">
              {t("Akun sosial workspace")}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => oauthDialogRef.current?.close()}
            className="rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-sm font-medium text-neutral-600 hover:border-pink-200 hover:text-[#a92e5d]"
          >
            {t("Tutup")} ✕
          </button>
        </div>

        <p className="mt-4 text-base text-neutral-600">{t("Kelola koneksi workspace di sini. Setelah menambah akun, tautkan ke bisnis yang sesuai melalui Kelola bisnis.")}</p>

        {authUser && <VeloxaMetaConnections key={brand.workspaceId} accountBusinessLabels={Object.fromEntries(connections.filter(account=>account.connectionId).map(account=>[account.connectionId!,businesses.find(item=>item.connectionIds.includes(account.connectionId!))?.brand.businessName||'Belum ditautkan ke bisnis']))} workspaceId={brand.workspaceId} initialChannel={editingChannel} reviewAccounts={reviewOAuthAccounts} startAdding={startAddingSocialAccount} onConnections={verified => {
          setConnectionsVerified(true);
          setConnections(withConnectionPlaceholders(verified,INITIAL_CHANNEL_CONNECTIONS));
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
        className="max-w-md border border-neutral-200 bg-white p-0 text-neutral-900 shadow-xl"
      >
        <div className="p-5 sm:p-6">
          <header className="flex items-center justify-between gap-4">
            <h2 id="logout-confirm-title" className="text-xl font-semibold leading-tight">{t('Keluar dari akun?')}</h2>
            <button
              type="button"
              aria-label={t('Tutup')}
              onClick={() => logoutConfirmDialogRef.current?.close()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div id="logout-confirm-desc" className="mt-3 space-y-1 text-base leading-relaxed">
            {authUser?.email && <p className="font-medium [overflow-wrap:anywhere]"><bdi>{authUser.email}</bdi></p>}
            <p className="text-neutral-600">{t('Anda dapat masuk kembali kapan saja.')}</p>
          </div>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-4 sm:px-6">
          <button type="button" autoFocus onClick={() => logoutConfirmDialogRef.current?.close()} className="veloxa-button-secondary">{t('Batal')}</button>
          <button type="button" onClick={() => void handleConfirmSignOut()} className="veloxa-button-primary">{t('Keluar akun')}</button>
        </footer>
      </dialog>
    </div>
    </WorkspaceLanguage>
  );
}
