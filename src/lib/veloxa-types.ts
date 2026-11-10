export type VeloxaRole = 'admin' | 'user';

export type RuntimePlatform = 'web' | 'android' | 'ios';

export type SocialChannelId = 'instagram' | 'facebook' | 'tiktok' | 'youtube_shorts';

export type ContentFormat = 'carousel' | 'single_post' | 'short_video';

export type BusinessCategory =
  | 'cafe_fnb'
  | 'running_event'
  | 'clinic_beauty'
  | 'fashion_retail'
  | 'education'
  | 'software_saas'
  | 'professional_services'
  | 'creative_agency'
  | 'retail_wholesale'
  | 'ecommerce'
  | 'manufacturing'
  | 'hotel_hospitality'
  | 'travel_tourism'
  | 'property'
  | 'construction'
  | 'automotive'
  | 'logistics'
  | 'finance'
  | 'agriculture'
  | 'home_services'
  | 'entertainment'
  | 'media'
  | 'nonprofit'
  | 'custom';

export type SubscriptionPlanId = 'free_trial' | 'starter_500k' | 'growth_1000k' | 'pro_1500k';

export interface SubscriptionPlanSpec {
  id: SubscriptionPlanId;
  name: string;
  tagline: string;
  priceMonthlyIdr: number;
  monthlyPostQuota: number;
  maxPostsPerDay: number;
  allowedChannels: SocialChannelId[];
  includesEventCampaigns: boolean;
  includesMetaAdsAgent: boolean;
  includesAutoOptimizer: boolean;
  estimatedApiCostPerPostIdr: number;
}

export interface BrandOfferingItem {
  id: string;
  title: string;
  category: 'product' | 'event' | 'promo' | 'service';
  priceLabel: string;
  highlight: string;
  ctaUrl?: string;
  eventDateIso?: string;
}

export interface BrandProfile {
  workspaceId: string;
  businessName: string;
  businessDescription?: string;
  category: BusinessCategory;
  city: string;
  targetAudience: string;
  brandTone: string;
  logoAssetId?: string;
  useBrandPalette?: boolean;
  additionalColorHexes?: string[];
  primaryColorHex: string;
  accentColorHex: string;
  visualVibe: string;
  defaultCta: string;
  whatsappNumber: string;
  websiteUrl: string;
  forbiddenWords: string[];
  prioritizeRealAssets: boolean;
  offerings: BrandOfferingItem[];
}

export type VaultDrawerType = 'style_reference' | 'real_asset';

export interface ExtractedStyleDna {
  layoutPattern: string;
  colorMood: string;
  typographyStyle: string;
  hookFormula: string;
  pacingNotes: string;
}

export interface BrandVaultAsset {
  id: string;
  workspaceId: string;
  drawer: VaultDrawerType;
  mediaType: 'photo' | 'video_reel';
  title: string;
  description: string;
  previewUrl: string;
  aspectRatio: '4:5' | '9:16' | '1:1';
  tags: string[];
  uploadedFrom: RuntimePlatform;
  createdAt: string;
  usedInPostsCount: number;
  extractedStyleDna?: ExtractedStyleDna;
  trashedAt?: string;
}

export interface ChannelConnectionState {
  channel: SocialChannelId;
  connected: boolean;
  handle: string;
  accountName: string;
  followerCount: number;
  oauthMode: 'direct_publish' | 'pending_review' | 'disconnected';
  tokenExpiresAt: string | null;
  lastPublishedAt: string | null;
}

export interface MetaAdsAccountConnection {
  connected: boolean;
  adAccountId: string;
  adAccountName: string;
  businessPortfolioName: string;
  currency: 'IDR';
  paymentMethodLabel: string;
  dailyHardCapIdr: number;
  monthlyHardCapIdr: number;
  autoOptimizeEnabled: boolean;
  autoBoostOrganicWinners: boolean;
}

export interface SlideSpec {
  slideNumber: number;
  headline: string;
  body: string;
  visualDirection: string;
  sourceAssetId?: string;
  badgeText: string;
}

export interface VideoSceneSpec {
  sceneNumber: number;
  timeRange: string;
  textOverlay: string;
  voiceover: string;
  visualDirection: string;
  sourceAssetId?: string;
}

export interface QualityReviewReport {
  passed: boolean;
  score: number;
  repairAttempts: number;
  summary: string;
  issues: string[];
  checkedAspects: {
    brandAlignment: boolean;
    typographyContrast: boolean;
    copyAccuracy: boolean;
    styleReferenceMatch: boolean;
  };
}

export interface ChannelPublishStatus {
  channel: SocialChannelId;
  status: 'pending' | 'scheduled' | 'publishing' | 'published' | 'skipped' | 'failed' | 'unknown';
  permalink?: string;
  publishedAt?: string;
  note?: string;
}

export interface OrganicPerformanceMetrics {
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  engagementRatePct: number;
  isOrganicWinner: boolean;
  recommendedAdDailyBudgetIdr?: number;
}

export interface ContentDraft {
  referenceRoles?: import('./content-reference-roles').ContentReferenceRoles;
  id: string;
  profileContext?: { fingerprint: string; snapshotRevision: number };
  workspaceId: string;
  source: 'manual_studio' | 'autonomous_agent' | 'event_campaign';
  format: ContentFormat;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  targetChannels: SocialChannelId[];
  channelStatuses: ChannelPublishStatus[];
  status: 'draft' | 'repairing' | 'approved' | 'scheduled' | 'published' | 'publishing' | 'publish_failed' | 'partially_published' | 'needs_attention';
  renderedMedia?: { url: string; mimeType: 'image/jpeg'; width: number; height: number };
  renderedVideo?: { url: string; mimeType: 'video/mp4'; width: number; height: number; durationSeconds: number; voiceDisclosure: string };
  renderedSlides?: { url: string; mimeType: 'image/jpeg'; width: number; height: number }[];
  publishTargets?: { channel: SocialChannelId; accountId: string; accountName: string; handle: string }[];
  scheduledForWib?: string;
  publishedAtWib?: string;
  slides?: SlideSpec[];
  videoScenes?: VideoSceneSpec[];
  videoDurationSeconds?: number;
  voiceoverModel?: string;
  usedStyleReferenceId?: string;
  usedRealAssetIds: string[];
  referenceInstruction?: string;
  qualityReview: QualityReviewReport;
  organicMetrics?: OrganicPerformanceMetrics;
  linkedCampaignId?: string;
}

export type AutonomyExecutionMode = 'full_autonomous' | 'copilot_review';

export interface AutonomyConfig {
  workspaceId: string;
  enabled: boolean;
  executionMode: AutonomyExecutionMode;
  postsPerDay: 1 | 2 | 3 | 4;
  scheduleTimesWib: string[];
  activeDays: ('Sen' | 'Sel' | 'Rab' | 'Kam' | 'Jum' | 'Sab' | 'Min')[];
  preferredFormats: ContentFormat[];
  targetChannels: SocialChannelId[];
  contentMixPct: {
    educationTips: number;
    communityStory: number;
    productEventPromo: number;
  };
  autoRepairUntilZeroIssues: boolean;
}

export type EventCampaignPhase =
  | 'teaser_awareness'
  | 'early_bird_launch'
  | 'training_education'
  | 'countdown_urgency'
  | 'event_day_live'
  | 'post_event_recap';

export interface EventCampaign {
  id: string;
  workspaceId: string;
  name: string;
  eventDateIso: string;
  location: string;
  ticketOrPromoHighlight: string;
  targetRegistrationsOrSales: number;
  currentConversions: number;
  status: 'active' | 'Scheduled' | 'completed';
  currentPhase: EventCampaignPhase;
  autoInjectIntoDailyAutonomy: boolean;
}

export type MetaAdObjective =
  | 'WHATSAPP_MESSAGES'
  | 'WEBSITE_CONVERSIONS'
  | 'INSTAGRAM_PROFILE_VISITS'
  | 'LEAD_GENERATION';

export interface MetaInterestTarget {
  id: string;
  name: string;
  category: string;
  audienceSizeLower: number;
  audienceSizeUpper: number;
  relevanceReason: string;
}

export interface MetaLocationTarget {
  cityOrPinName: string;
  province: string;
  radiusKm: number;
}

export interface MetaDemographicSpec {
  ageMin: number;
  ageMax: number;
  genders: 'all' | 'male' | 'female';
  locations: MetaLocationTarget[];
  languages: string[];
  advantagePlusAudienceEnabled: boolean;
}

export interface MetaAdCreativeVariant {
  id: string;
  variantLabel: 'Variasi A · Reels 9:16' | 'Variasi B · Carousel/Poster';
  sourceDraftId?: string;
  headline: string;
  primaryText: string;
  ctaButton: 'Send WhatsApp Message' | 'Sign Up' | 'Learn More' | 'Book Now';
  budgetSharePct: number;
  status: 'active' | 'paused_by_ai_loser' | 'winner_scaled';
  metrics: {
    spendIdr: number;
    impressions: number;
    clicks: number;
    ctrPct: number;
    conversions: number;
    costPerResultIdr: number;
    frequency: number;
  };
}

export interface MetaOptimizationAction {
  id: string;
  timestampWib: string;
  actionType: 'kill_underperforming_creative' | 'scale_winner_budget' | 'refresh_fatigued_creative' | 'cap_guard_enforced';
  summary: string;
  savedOrReallocatedIdr: number;
}

export interface MetaAdCampaignPlan {
  id: string;
  workspaceId: string;
  campaignName: string;
  objective: MetaAdObjective;
  status: 'draft_paused' | 'active_running' | 'completed';
  promotedOfferingTitle: string;
  destinationUrlOrWa: string;
  demographics: MetaDemographicSpec;
  validatedInterests: MetaInterestTarget[];
  budget: {
    requestedDailyBudgetIdr: number;
    appliedDailyBudgetIdr: number;
    hardCapClamped: boolean;
    durationDays: number;
    totalBudgetIdr: number;
    spentToDateIdr: number;
  };
  estimatedDailyOutcome: {
    reachMin: number;
    reachMax: number;
    estimatedClicksMin: number;
    estimatedClicksMax: number;
    estimatedCostPerResultIdr: number;
  };
  creatives: MetaAdCreativeVariant[];
  optimizationLogs: MetaOptimizationAction[];
  originatedFromOrganicDraftId?: string;
}

export interface TenantWorkspaceSummary {
  workspaceId: string;
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  category: BusinessCategory;
  planId: SubscriptionPlanId;
  subscriptionStatus: 'active' | 'trial' | 'past_due';
  postsPublishedThisMonth: number;
  monthlyPostQuota: number;
  connectedChannels: SocialChannelId[];
  metaAdsConnected: boolean;
  activeMetaCampaigns: number;
  monthlySubscriptionRevenueIdr: number;
  estimatedMonthlyApiCostIdr: number;
  grossMarginPct: number;
}

export interface CentralPlatformCredentials {
  openAiModelText: string;
  openAiModelImage: string;
  openAiModelVoice: string;
  openAiApiKeyConfigured: boolean;
  metaAppId: string;
  metaAppReviewStatus: 'advanced_access_ready' | 'in_review';
  tiktokClientKey: string;
  tiktokDirectPostAuditStatus: 'approved_direct_post' | 'sandbox_ready';
  youtubeOAuthClientId: string;
  youtubeDailyQuotaUnits: number;
  paymentGatewayProvider: 'Midtrans' | 'Xendit';
  globalMaxRepairAttemptsPerJob: number;
}
