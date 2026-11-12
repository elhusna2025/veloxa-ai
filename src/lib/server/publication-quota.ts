import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import type { SubscriptionPlanId } from '../veloxa-types';
import { adminQuotaRefs, resolveAdminQuota } from './admin-settings';
import { wibDay, wibMonth } from './clock';
import { ApiError } from './http';

export interface PublicationQuota {
  month: string;
  used: number;
  limit: number;
  day: string;
  dailyUsed: number;
  dailyLimit: number | null;
}

type Ref = FirebaseFirestore.DocumentReference;
type Tx = FirebaseFirestore.Transaction;
export const monthlyPublicationUsage = (ref: Ref, month: string) => ref.collection('publish_usage').doc(month);
const dailyPublicationUsage = (ref: Ref, day: string) => ref.collection('publish_daily_usage').doc(day);

function count(value: unknown) {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new ApiError(503, 'Penggunaan kuota publikasi belum dapat diperiksa.', 'publication_quota_unavailable');
  }
  return value;
}

export async function readPublicationQuota(ref: Ref, planId: SubscriptionPlanId, tx?: Tx, at = new Date()): Promise<PublicationQuota> {
  const month = wibMonth(at);
  const day = wibDay(at);
  const policy = adminQuotaRefs(ref.firestore, ref.id, planId);
  const refs = [policy.plan, policy.workspace, monthlyPublicationUsage(ref, month), dailyPublicationUsage(ref, day)];
  const [plan, workspace, monthly, daily] = tx
    ? await tx.getAll(...refs)
    : await Promise.all(refs.map(document => document.get()));
  const settings = resolveAdminQuota(planId, plan.data(), workspace.data());
  return {
    month, used: count(monthly.data()?.count), limit: settings.monthlyPublicationLimit ?? SUBSCRIPTION_PLANS[planId].monthlyPostQuota,
    day, dailyUsed: count(daily.data()?.count), dailyLimit: settings.dailyPublicationLimit ?? null,
  };
}

export function assertPublicationCapacity(quota: PublicationQuota) {
  if (quota.used >= quota.limit) throw new ApiError(429, 'Kuota publikasi bulan ini habis.', 'quota_exhausted');
  if (quota.dailyLimit !== null && quota.dailyUsed >= quota.dailyLimit) {
    throw new ApiError(429, 'Kuota publikasi hari ini habis. Coba lagi besok.', 'daily_publication_quota_exhausted');
  }
}

export function incrementPublicationUsage(tx: Tx, ref: Ref, quota: PublicationQuota) {
  tx.set(monthlyPublicationUsage(ref, quota.month), { count: quota.used + 1 }, { merge: true });
  tx.set(dailyPublicationUsage(ref, quota.day), { count: quota.dailyUsed + 1 }, { merge: true });
  tx.update(ref, { quotaUsed: quota.used + 1 });
}

/** Untracked legacy reservations have no daily debit to reverse. */
export async function releasePublicationUsage(tx: Tx, ref: Ref, reservation: { reservedMonth?: unknown; reservedDay?: unknown }, at = new Date()) {
  const { reservedMonth, reservedDay } = reservation;
  if (typeof reservedMonth !== 'string' || !/^\d{4}-\d{2}$/.test(reservedMonth) ||
    (reservedDay != null && (typeof reservedDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reservedDay) || reservedDay.slice(0, 7) !== reservedMonth))) {
    throw new ApiError(503, 'Pencatatan kuota publikasi belum dapat diperiksa.', 'publication_quota_unavailable');
  }
  const monthRef = monthlyPublicationUsage(ref, reservedMonth);
  const dayRef = typeof reservedDay === 'string' ? dailyPublicationUsage(ref, reservedDay) : null;
  const [month, day] = dayRef ? await tx.getAll(monthRef, dayRef) : [await tx.get(monthRef)];
  const remaining = Math.max(0, count(month.data()?.count) - 1);
  const remainingToday = day ? Math.max(0, count(day.data()?.count) - 1) : null;
  tx.set(monthRef, { count: remaining }, { merge: true });
  if (dayRef) tx.set(dayRef, { count: remainingToday }, { merge: true });
  if (reservedMonth === wibMonth(at)) tx.update(ref, { quotaUsed: remaining });
}
