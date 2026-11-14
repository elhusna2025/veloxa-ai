export interface MetaAdsExecution {
  planId: string;
  title?: string;
  adAccountId: string;
  adAccountName: string;
  connectionId: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  status: 'preparing' | 'paused' | 'activating' | 'active' | 'pausing' | 'attention';
  destinationUrl: string;
  dailyBudgetIdr: number;
  totalBudgetIdr: number;
  durationDays: number;
  endsAt?: number;
  updatedAt: number;
  message?: string;
  canResume?: boolean;
  reviewBeforeResume?: boolean;
  paymentRequired?: boolean;
  effectiveStatus?: string;
  insights?: { spendIdr: number; impressions: number; clicks: number; asOf: number };
}

export interface MetaAdsDashboard {
  canManage: boolean;
  canPrepare: boolean;
  connection: 'connected' | 'disconnected' | 'expired' | 'permission_error' | 'unavailable';
  missingScopes?: string[];
  accounts: { id: string; name: string; currency: string; eligible: boolean }[];
  identities: { connectionId: string; name: string }[];
  campaigns: MetaAdsExecution[];
}
