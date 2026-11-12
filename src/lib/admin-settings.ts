import type { SubscriptionPlanId } from './veloxa-types';

export const DEFAULT_CONTENT_MODELS = {
  scriptModel: 'gpt-6-luna',
  imageModel: 'gpt-image-2.6-sunburst',
  voiceModel: 'gpt-realtime-2.1-mini',
} as const;

export type AdminModelKey = keyof typeof DEFAULT_CONTENT_MODELS;
export type AdminModelOverrides = Partial<Record<AdminModelKey, string>>;
export type AdminQuotaOverrides = {
  dailyDraftLimit?: number | null;
  monthlyPublicationLimit?: number;
  dailyPublicationLimit?: number;
};

export type AdminPlanSettings = {
  id: SubscriptionPlanId;
  label: string;
  dailyDraftLimit: number;
  monthlyPublicationLimit: number;
  dailyPublicationLimit: number | null;
};

export type AdminSettingsAudit = {
  id: string;
  actor: string;
  action: 'update' | 'restore';
  reason: string;
  at: number;
  revision: number;
  restoredFrom?: number;
  changes?: string[];
};

type SettingsBase = {
  revision: number;
  models: AdminModelOverrides;
  defaultModels: Record<AdminModelKey, string>;
  effectiveModels: Record<AdminModelKey, string>;
  availableModels: Record<AdminModelKey, string[]>;
  audit: AdminSettingsAudit[];
};

export type AdminSettingsView = SettingsBase & (
  | { scope: 'global'; plans: AdminPlanSettings[] }
  | {
    scope: 'workspace';
    workspaceId: string;
    workspaceName: string;
    quota: AdminQuotaOverrides;
    effectiveQuota: Required<Omit<AdminQuotaOverrides, 'dailyPublicationLimit'>> & { dailyPublicationLimit: number | null };
  }
);

export type AdminSettingsUpdate = {
  workspaceId?: string;
  expectedRevision: number;
  reason: string;
  models?: AdminModelOverrides;
  quota?: AdminQuotaOverrides;
  plans?: Omit<AdminPlanSettings, 'label'>[];
  restoreRevision?: number;
};
