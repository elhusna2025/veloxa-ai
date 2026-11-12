import type { MetaChannel } from './meta-graph';

export interface PublishReceipt {
  connectionId?: string;
  accountId?: string;
  accountName?: string;
  handle?: string;
  channel: MetaChannel;
  status: 'published' | 'failed' | 'unknown';
  externalPostId?: string;
  providerContainerId?: string;
  confirmedAt?: string;
  permalink?: string;
  error?: string;
  retryable?: boolean;
  publishedAt?: string;
}

export function confirmedReceiptAt(receipts: PublishReceipt[]) {
  const confirmed = receipts.filter(receipt => receipt.status === 'published')
    .map(receipt => {
      const publishedAt = Date.parse(receipt.publishedAt || '');
      return Number.isFinite(publishedAt) && publishedAt > 0 ? publishedAt : Date.parse(receipt.confirmedAt || '');
    })
    .filter(value => Number.isFinite(value) && value > 0);
  return confirmed.length ? { lastConfirmedAt: Math.max(...confirmed) } : {};
}
