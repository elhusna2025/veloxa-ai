import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import { effectiveWorkspacePlan } from '../subscription';
import type { SubscriptionPlanId } from '../veloxa-types';
import type { GenerationQuota } from '../content-generation';
import { ApiError } from './http';
import { wibDay } from './clock';
import { adminQuotaRefs, resolveAdminQuota } from './admin-settings';

/** Admin-only platform config. Never trust a body, profile, or workspace snapshot flag. */
export async function generationPolicy(ref: DocumentReference, workspaceId: string, planId: SubscriptionPlanId, tx?: Transaction): Promise<Pick<GenerationQuota, 'mode' | 'dailyLimit'>> {
  const read = (document: DocumentReference) => tx ? tx.get(document) : document.get();
  const policy = adminQuotaRefs(ref.firestore, workspaceId, planId);
  const plan = (await read(policy.plan)).data();
  const workspace = (await read(policy.workspace)).data();
  const override = resolveAdminQuota(planId, undefined, workspace).dailyDraftLimit;
  if (override === null) return { mode: 'development', dailyLimit: null };
  if (override !== undefined) return { mode: 'standard', dailyLimit: override };

  // Legacy development exemptions remain active unless this workspace has an explicit policy.
  let legacy;
  try { legacy = (await read(ref.firestore.collection('platform_configs').doc(`generation_${workspaceId}`))).data(); }
  catch { /* An unverified legacy record never grants an exemption. */ }
  if (legacy?.workspaceId === workspaceId && legacy.mode === 'development' && legacy.enabled === true) return { mode: 'development', dailyLimit: null };
  const planLimit = resolveAdminQuota(planId, plan, undefined).dailyDraftLimit;
  return { mode: 'standard', dailyLimit: planLimit ?? SUBSCRIPTION_PLANS[planId].maxPostsPerDay * 3 };
}
function validCount(value: unknown): number {
  const count = value === undefined ? 0 : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) throw new ApiError(503, 'Penggunaan pembuatan konten belum dapat diverifikasi. Silakan coba lagi.');
  return count;
}
export async function reserveGenerationAttempt(
  ref: DocumentReference,
  workspaceId: string,
  planId: SubscriptionPlanId,
  scheduledJob?: DocumentReference,
): Promise<GenerationQuota> {
  const today = wibDay();
  return ref.firestore.runTransaction(async tx => {
    // The workspace, policy and counter share the same transaction as a new reservation.
    const workspace = (await tx.get(ref)).data();
    if (!workspace) throw new ApiError(409, 'Workspace tidak lagi tersedia.');
    const currentPlan = workspace.subscriptionPlanId === undefined ? planId : effectiveWorkspacePlan(workspace);
    const policy = await generationPolicy(ref, workspaceId, currentPlan, tx);
    const job = scheduledJob ? (await tx.get(scheduledJob)).data() : undefined;
    if (scheduledJob && job?.state !== 'generating') {
      throw new ApiError(409, 'Slot Otonom sudah berubah. Periksa jadwal sebelum melanjutkan.');
    }
    // Recovery belongs to the same slot and its original WIB reservation, including after midnight.
    const reservedDay = typeof job?.generationQuotaDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(job.generationQuotaDay)
      ? job.generationQuotaDay : undefined;
    const day = reservedDay ?? today;
    const usage = ref.collection('generation_usage').doc(day);
    const count = validCount((await tx.get(usage)).data()?.count);
    if (reservedDay) return { ...policy, day, used: count };
    if (policy.dailyLimit !== null && count >= policy.dailyLimit) throw new ApiError(429, 'Batas pembuatan konten hari ini tercapai. Coba lagi besok.', 'daily_draft_quota_exhausted');
    if (scheduledJob) tx.update(scheduledJob, { generationQuotaDay: day });
    tx.set(usage, { count: count + 1 });
    return { ...policy, day, used: count + 1 };
  });
}
export async function generationQuotaStatus(ref: DocumentReference, workspaceId: string, planId: SubscriptionPlanId): Promise<GenerationQuota> {
  const day = wibDay();
  const [policy, usage] = await Promise.all([generationPolicy(ref, workspaceId, planId), ref.collection('generation_usage').doc(day).get()]);
  return { ...policy, day, used: validCount(usage.data()?.count) };
}
