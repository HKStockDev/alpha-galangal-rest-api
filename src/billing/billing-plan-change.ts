import { SubscriptionPlanRow } from './billing.types';

export type PlanChangeKind = 'upgrade' | 'downgrade' | 'interval_change';

export type PlanChangeStripeParams = {
  proration_behavior: 'create_prorations' | 'none';
  billing_cycle_anchor: 'now' | 'unchanged';
};

const TIER_RANK: Record<string, number> = {
  professional: 1,
  team: 2,
  enterprise: 3,
};

/** Effective recurring amount in cents for comparing upgrade vs downgrade on the same interval. */
export function effectiveRecurringCents(plan: SubscriptionPlanRow, quantity: number): number {
  const qty = Math.max(1, quantity);
  if (plan.pricing_model === 'per_seat' || plan.seat_based_enabled) {
    return (plan.unit_amount_cents ?? 0) * qty;
  }
  return plan.amount_cents ?? 0;
}

export function planTierRank(planKey: string): number {
  if (planKey.startsWith('team_')) return TIER_RANK.team;
  if (planKey.startsWith('enterprise_')) return TIER_RANK.enterprise;
  return TIER_RANK.professional;
}

function normalizeBillingInterval(interval: string | null | undefined): string | null {
  if (!interval) return null;
  const v = interval.trim().toLowerCase();
  if (v === 'month' || v === 'monthly') return 'month';
  if (v === 'year' || v === 'yearly' || v === 'annual') return 'year';
  return v;
}

/**
 * Classify a plan switch for Stripe proration and billing_cycle_anchor.
 *
 * Priority: billing interval change (month <-> year) wins over tier/seat upgrade/downgrade.
 */
export function classifyPlanChange(
  current: SubscriptionPlanRow,
  target: SubscriptionPlanRow,
  currentQuantity: number,
  targetQuantity: number,
): PlanChangeKind {
  const currentInterval = normalizeBillingInterval(current.billing_interval);
  const targetInterval = normalizeBillingInterval(target.billing_interval);

  if (
    currentInterval &&
    targetInterval &&
    currentInterval !== targetInterval
  ) {
    return 'interval_change';
  }

  const currentTier = planTierRank(current.plan_key);
  const targetTier = planTierRank(target.plan_key);
  if (targetTier > currentTier) {
    return 'upgrade';
  }
  if (targetTier < currentTier) {
    return 'downgrade';
  }

  const currentCents = effectiveRecurringCents(current, currentQuantity);
  const targetCents = effectiveRecurringCents(target, targetQuantity);
  if (targetCents > currentCents) {
    return 'upgrade';
  }
  if (targetCents < currentCents) {
    return 'downgrade';
  }

  // Same tier, interval, and recurring total (should be blocked earlier by identical price id).
  return 'upgrade';
}

/** Product rules: upgrade/downgrade/interval_change -> proration + billing_cycle_anchor. */
export function resolvePlanChangeStripeParams(kind: PlanChangeKind): PlanChangeStripeParams {
  switch (kind) {
    case 'upgrade':
      return {
        proration_behavior: 'create_prorations',
        billing_cycle_anchor: 'unchanged',
      };
    case 'downgrade':
      return {
        proration_behavior: 'none',
        billing_cycle_anchor: 'unchanged',
      };
    case 'interval_change':
      return {
        proration_behavior: 'create_prorations',
        billing_cycle_anchor: 'now',
      };
  }
}
