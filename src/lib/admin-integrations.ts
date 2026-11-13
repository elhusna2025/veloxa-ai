import type { MetaAdsExecution } from './meta-ads';

export interface AdminIntegrationStatus {
  workspaceName: string;
  advertising: { status: 'connected' | 'disconnected' | 'expired' | 'permission_error'; expiresAt: number | null };
  accounts: { id: string; channel: 'facebook' | 'instagram'; label: string; business: string | null; expiresAt: number | null }[];
  campaigns: {
    id: string;
    title: string;
    business: string;
    status: MetaAdsExecution['status'];
    accountName: string;
    updatedAt: number;
    totalBudgetIdr: number;
    insights?: MetaAdsExecution['insights'];
  }[];
}
