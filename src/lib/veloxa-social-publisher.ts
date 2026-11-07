/** Social profile helpers. Live publication runs only through the authenticated server adapter. */

import type {
  ContentDraft,
  MetaAdCampaignPlan,
  SocialChannelId,
} from './veloxa-types';

export interface ChannelPublishReceipt {
  channel: SocialChannelId;
  status: 'published' | 'failed';
  externalPostId: string;
  publishedAtWib: string;
  providerEndpoint: string;
  executionMode: 'live_api' | 'smart_connect_verified' | 'sandbox_verified';
  profileUrl?: string;
}

export interface MultiChannelPublishResult {
  draftId: string;
  publishedAtWib: string;
  receipts: ChannelPublishReceipt[];
}

/**
 * Normalizes a user's input (username, @handle, or full URL like https://instagram.com/ulinz_cafe)
 * into a clean handle (e.g. `@ulinz_cafe`).
 */
export function normalizeSocialHandle(channel: SocialChannelId, rawInput: string): string {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return '';

  // Strip full URL prefixes if the user pasted a profile link
  const withoutUrl = trimmed
    .replace(/^https?:\/\/(www\.)?(instagram\.com|facebook\.com|tiktok\.com|youtube\.com)\//i, '')
    .replace(/\/+$/, '')
    .split('?')[0];

  if (channel === 'facebook') {
    return withoutUrl.replace(/^@/, '') || trimmed;
  }
  const cleanUser = withoutUrl.replace(/^@+/, '').replace(/\s+/g, '');
  return cleanUser ? `@${cleanUser}` : trimmed;
}

/**
 * Builds the real, clickable public URL for a connected social account.
 */
export function buildSocialProfileUrl(channel: SocialChannelId, handle: string): string {
  const clean = (handle || '').trim().replace(/^@+/, '');
  if (!clean) {
    if (channel === 'instagram') return 'https://www.instagram.com/';
    if (channel === 'facebook') return 'https://www.facebook.com/';
    if (channel === 'tiktok') return 'https://www.tiktok.com/';
    return 'https://www.youtube.com/';
  }
  if (channel === 'instagram') {
    return `https://www.instagram.com/${encodeURIComponent(clean)}/`;
  }
  if (channel === 'facebook') {
    return `https://www.facebook.com/${encodeURIComponent(clean.replace(/\s+/g, ''))}`;
  }
  if (channel === 'tiktok') {
    return `https://www.tiktok.com/@${encodeURIComponent(clean)}`;
  }
  return `https://www.youtube.com/@${encodeURIComponent(clean)}`;
}

export async function publishDraftToConnectedChannels(params: {
  draft: ContentDraft;
  tokens?: Partial<Record<SocialChannelId, string>>;
  handles?: Partial<Record<SocialChannelId, string>>;
}): Promise<MultiChannelPublishResult> {
  throw new Error('Publikasi memerlukan koneksi Meta resmi dan endpoint server Veloxa.');
}

export interface MetaAdsExecutionReceipt {
  campaignId: string;
  metaCampaignRemoteId: string;
  metaAdSetRemoteId: string;
  metaAdRemoteIds: string[];
  adAccountId: string;
  appliedDailyBudgetIdr: number;
  status: 'ACTIVE' | 'PAUSED';
  executedAtWib: string;
  executionMode: 'live_meta_marketing_api' | 'sandbox_verified';
}

export async function executeMetaAdsCampaignOnGraphApi(params: {
  campaign: MetaAdCampaignPlan;
  adAccountId: string;
  metaAccessToken?: string;
  targetStatus: 'ACTIVE' | 'PAUSED';
}): Promise<MetaAdsExecutionReceipt> {
  throw new Error('Eksekusi iklan belum diaktifkan. Tidak ada kampanye yang dikirim ke Meta.');
}
