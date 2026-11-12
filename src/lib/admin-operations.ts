import type { GenerationQuota } from './content-generation';

export const ATTENTION_STATES = ['needs_attention', 'failed', 'skipped'] as const;
export const RECOVERY_STATES = ['retry_generation', 'retry_publication', 'queued'] as const;

export interface AdminWorkspace { id: string; name: string; plan: string; onboarded: boolean }
export interface AdminRule {
  workspaceId: string;
  businessId: string;
  workspaceName: string;
  businessName: string;
  revision: number;
  enabled: boolean;
  processing: boolean;
  reconciling?: boolean;
  nextSlot: number | null;
  issue: string | null;
}
export interface AdminReceipt {
  channel: 'instagram' | 'facebook';
  account: string;
  status: 'published' | 'failed' | 'unknown';
  permalink: string | null;
}
export interface AdminJob {
  id: string;
  rule: AdminRule;
  state: string;
  scheduledAt: number | null;
  retryAt: number | null;
  format: string | null;
  generationAttempts: number | null;
  publicationAttempts: number | null;
  receipts: AdminReceipt[];
}
export interface AdminOverview {
  activeWorkspaces: number;
  publishedToday: number;
  publishedLowerBound: boolean;
  activityPartial: boolean;
  recovering: number;
  attention: number;
  scheduler: { schedulerReady: boolean; lastTickAt: number | null };
  actions: AdminJob[];
  blocked: AdminRule[];
  upcoming: AdminRule[];
}
export interface AdminWorkspacePage { items: AdminWorkspace[]; cursor: string | null }
export interface AdminPauseAudit { id: string; actor: string; reason: string; at: number; businessName: string; processing: boolean }
export interface AdminWorkspaceDetail {
  workspace: AdminWorkspace;
  publication: { used: number; limit: number; month: string; day?: string; dailyUsed?: number; dailyLimit?: number | null };
  generation: GenerationQuota;
  businesses: { id: string; name: string; accounts: { id: string; label: string; channel: string; ready: boolean }[]; rule: AdminRule | null }[];
  unassigned: AdminWorkspaceDetail['businesses'][number]['accounts'];
  profileStatus: 'ready' | 'missing' | 'unavailable';
  jobs: AdminJob[];
  pauseAudit?: AdminPauseAudit[];
}
export interface AdminOperations {
  jobs: AdminJob[];
  blocked: AdminRule[];
  rules: AdminRule[];
  ruleLimitReached: boolean;
  activityPartial: boolean;
  scheduler: AdminOverview['scheduler'];
}
