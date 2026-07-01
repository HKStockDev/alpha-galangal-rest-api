import {
  classifyPlanChange,
  PlanChangeKind,
  resolvePlanChangeStripeParams,
  PlanChangeStripeParams,
} from './billing-plan-change';
import { SubscriptionPlanRow } from './billing.types';

export function isPerSeatPlan(
  plan: Pick<SubscriptionPlanRow, 'pricing_model' | 'seat_based_enabled'>,
): boolean {
  return plan.pricing_model === 'per_seat' || plan.seat_based_enabled;
}

/** Stripe update params when syncing seat quantity on the same plan (CON-100). */
export function resolveSeatSyncStripeParams(
  plan: SubscriptionPlanRow,
  currentQuantity: number,
  targetQuantity: number,
): { changeKind: PlanChangeKind; stripeParams: PlanChangeStripeParams } {
  const changeKind = classifyPlanChange(plan, plan, currentQuantity, targetQuantity);
  return {
    changeKind,
    stripeParams: resolvePlanChangeStripeParams(changeKind),
  };
}
