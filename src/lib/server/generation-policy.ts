import type { DocumentReference } from 'firebase-admin/firestore';
import { SUBSCRIPTION_PLANS } from '../veloxa-engine';
import type { SubscriptionPlanId } from '../veloxa-types';
import type { GenerationQuota } from '../content-generation';
import { ApiError } from './http';
import { wibDay } from './clock';

function policyFromConfig(config: Record<string, unknown> | undefined, workspaceId: string, planId: SubscriptionPlanId): Pick<GenerationQuota, 'mode' | 'dailyLimit'> {
  if (config?.workspaceId === workspaceId && config.mode === 'development' && config.enabled === true) return { mode: 'development', dailyLimit: null };
  return { mode: 'standard', dailyLimit: SUBSCRIPTION_PLANS[planId].maxPostsPerDay * 3 };
}
/** Admin-only platform config. Never trust a body, profile, or workspace snapshot flag. */
export async function generationPolicy(ref: DocumentReference, workspaceId: string, planId: SubscriptionPlanId): Promise<Pick<GenerationQuota, 'mode' | 'dailyLimit'>> {
  let config;
  try { config = (await ref.firestore.collection('platform_configs').doc(`generation_${workspaceId}`).get()).data(); }
  catch { /* Fail closed to the normal plan limit if configuration cannot be verified. */ }
  return policyFromConfig(config, workspaceId, planId);
}
function validCount(value: unknown): number {
  const count = value === undefined ? 0 : value;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) throw new ApiError(503, 'Penggunaan pembuatan konten belum dapat diverifikasi. Silakan coba lagi.');
  return count;
}
export async function reserveGenerationAttempt(ref: DocumentReference, workspaceId: string, planId: SubscriptionPlanId): Promise<GenerationQuota> {
  const day = wibDay();
  const usage = ref.collection('generation_usage').doc(day);
  const policyRef = ref.firestore.collection('platform_configs').doc(`generation_${workspaceId}`);
  return ref.firestore.runTransaction(async tx => {
    // Read policy and count in the same transaction so disabling conflicts with pending reservations.
    let config;
    try { config = (await tx.get(policyRef)).data(); }
    catch { /* An unverified policy never grants the development exemption. */ }
    const policy = policyFromConfig(config, workspaceId, planId);
    const count = validCount((await tx.get(usage)).data()?.count);
    if (policy.dailyLimit !== null && count >= policy.dailyLimit) throw new ApiError(429, 'Batas pembuatan konten hari ini tercapai. Coba lagi besok.');
    tx.set(usage, { count: count + 1 });
    return { ...policy, day, used: count + 1 };
  });
}
export async function generationQuotaStatus(ref: DocumentReference, workspaceId: string, planId: SubscriptionPlanId): Promise<GenerationQuota> {
  const day = wibDay();
  const [policy, usage] = await Promise.all([generationPolicy(ref, workspaceId, planId), ref.collection('generation_usage').doc(day).get()]);
  return { ...policy, day, used: validCount(usage.data()?.count) };
}
