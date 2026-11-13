import { SUBSCRIPTION_PLANS } from './veloxa-engine';
import type { SubscriptionPlanId } from './veloxa-types';

export type PaidPlanId = Exclude<SubscriptionPlanId, 'free_trial'>;

export function storedWorkspacePlan(workspace: Record<string, unknown>): SubscriptionPlanId {
  const id = workspace.subscriptionPlanId;
  return typeof id === 'string' && Object.hasOwn(SUBSCRIPTION_PLANS, id) ? id as SubscriptionPlanId : 'free_trial';
}

export function effectiveWorkspacePlan(workspace: Record<string, unknown>, now = Date.now()): SubscriptionPlanId {
  const plan = storedWorkspacePlan(workspace);
  const paidUntil = workspace.subscriptionPaidUntilMs;
  // Preserve entitlements created before Veloxa recorded a paid-through date.
  if (plan === 'free_trial' || paidUntil === undefined) return plan;
  return Number.isSafeInteger(paidUntil) && Number(paidUntil) > now ? plan : 'free_trial';
}
