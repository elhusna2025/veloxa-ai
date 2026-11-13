import type { AdminReceipt } from './admin-operations';

export type AdminIncidentStatus = 'open' | 'investigating' | 'resolved';

type BusinessScope = { workspaceId: string; businessId: string };

export type AdminIncidentSource =
  | { kind: 'scheduler'; lastCompletedAt: number | null }
  | (BusinessScope & { kind: 'rule'; revision: number })
  | (BusinessScope & { kind: 'process'; jobId: string; deadline: number })
  | (BusinessScope & { kind: 'slot'; jobId: string });

export interface AdminIncidentUpdate {
  actor: string;
  at: number;
  status: AdminIncidentStatus;
  note: string;
}

export interface AdminIncident {
  id: string;
  source: AdminIncidentSource;
  title: string;
  guidance: string;
  priority: 'urgent' | 'warning';
  workspaceName: string | null;
  businessName: string | null;
  at: number | null;
  detected: boolean;
  status: AdminIncidentStatus;
  revision: number;
  history: AdminIncidentUpdate[];
  receipts?: AdminReceipt[];
  failedSlots?: number;
}

export interface AdminIncidents {
  incidents: AdminIncident[];
  partial: boolean;
}
