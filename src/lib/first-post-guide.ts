import { businessTargetId } from './business-context';
import type { BrandProfile, ChannelConnectionState, ContentDraft } from './veloxa-types';

export function isPublishingAccount(account: ChannelConnectionState) {
  return account.connected && account.oauthMode === 'direct_publish' &&
    Boolean(account.connectionId) && (account.channel === 'instagram' || account.channel === 'facebook');
}

export function firstPostProgress(
  brand: BrandProfile,
  connections: ChannelConnectionState[],
  drafts: ContentDraft[],
  historyReady: boolean,
) {
  const accountIds = new Set(connections.filter(isPublishingAccount).map(account => account.connectionId));
  const hasAccount = accountIds.size > 0;
  const hasPublished = historyReady && drafts.some(draft =>
    draft.status === 'published' || draft.channelStatuses.some(channel => channel.status === 'published'),
  );
  const hasProfile = Boolean(brand.businessDescription?.trim());
  const reviewDraft = historyReady ? drafts.find(draft => {
    if (!['draft', 'approved', 'scheduled', 'publish_failed', 'publish_queued'].includes(draft.status)) return false;
    if (!draft.qualityReview.passed || !draft.publishTargets?.length) return false;
    if (!draft.publishTargets.every(target => accountIds.has(businessTargetId(target)))) return false;
    if (draft.format === 'carousel') return draft.renderedSlides?.length === 5;
    return Boolean(draft.format === 'short_video' ? draft.renderedVideo : draft.renderedMedia);
  }) : undefined;
  const current = !hasAccount ? 'account' : !hasProfile ? 'profile' : reviewDraft ? 'publish' : 'draft';
  return { hasAccount, hasPublished, hasProfile, reviewDraft, current } as const;
}
