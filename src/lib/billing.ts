import type { GenerationQuota } from './content-generation';
import type { PublicationQuota } from './server/publication-quota';
import type { PaidPlanId } from './subscription';
import type { SubscriptionPlanId } from './veloxa-types';

export const PAID_ACCESS_DAYS = 30;
export type BillingMode = 'disabled' | 'sandbox' | 'production';
export type InvoiceState = 'creating' | 'pending' | 'paid' | 'cancelled' | 'needs_review';

export interface BillingInvoice {
  id: string;
  planId: PaidPlanId;
  amountIdr: number;
  mode: Exclude<BillingMode, 'disabled'>;
  state: InvoiceState;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  paidUntil: number | null;
  paymentUrl: string | null;
  canCheck: boolean;
}

export interface BillingWorkspace {
  id: string;
  name: string;
  planId: SubscriptionPlanId;
  state: 'trial' | 'active' | 'expired' | 'legacy';
  paidUntil: number | null;
}

export interface WorkspaceBilling {
  workspace: BillingWorkspace;
  mode: BillingMode;
  canPay: boolean;
  invoices: BillingInvoice[];
  checkoutPending: boolean;
  plans: Array<{ id: SubscriptionPlanId; publicationLimit: number }>;
  publication: PublicationQuota;
  generation: GenerationQuota;
}

export interface AdminBillingDetail extends WorkspaceBilling {
  costs: { month: string; savedDrafts: number; estimatedAiIdr: number; paidIdr: number; reviewInvoices: number };
}

export interface AdminBillingList {
  mode: BillingMode;
  workspaces: BillingWorkspace[];
  nextCursor: string | null;
}

export const invoiceStates: Record<InvoiceState, string> = {
  creating: 'Menunggu konfirmasi tagihan', pending: 'Menunggu pembayaran', paid: 'Lunas',
  cancelled: 'Dibatalkan', needs_review: 'Perlu diperiksa',
};

export const billingStates: Record<BillingWorkspace['state'], string> = {
  trial: 'Uji coba', active: 'Aktif', expired: 'Akses berbayar berakhir', legacy: 'Paket lama',
};

export const formatBillingIdr = (amount: number) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(amount);

export const formatBillingDate = (millis: number) => new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
}).format(millis) + ' WIB';
