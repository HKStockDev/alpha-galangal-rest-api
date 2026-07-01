import type { CreditPolicyConfigRow } from './credits.types';

/** Unused base credits that roll into the next billing cycle (cap applies to base only). */
export function computeCarriedBaseCredits(
  remaining: number,
  policy: Pick<CreditPolicyConfigRow, 'base_carryover_enabled' | 'carryover_cap_credits'>,
): number {
  if (!policy.base_carryover_enabled || remaining <= 0) {
    return 0;
  }
  const cap = policy.carryover_cap_credits;
  if (cap == null) {
    return remaining;
  }
  return Math.min(remaining, Math.max(0, cap));
}

export function computeBillingPeriodRemainingFraction(
  periodStartUnix: number | null | undefined,
  periodEndUnix: number | null | undefined,
  nowUnix = Math.floor(Date.now() / 1000),
): number | null {
  if (periodStartUnix == null || periodEndUnix == null) {
    return null;
  }
  if (periodEndUnix <= periodStartUnix) {
    return null;
  }
  const total = periodEndUnix - periodStartUnix;
  const remaining = periodEndUnix - nowUnix;
  if (remaining <= 0) {
    return 0;
  }
  if (remaining >= total) {
    return 1;
  }
  return remaining / total;
}

export function isPlanCreditUpgrade(
  previousMonthlyBase: number | null | undefined,
  newMonthlyBase: number,
): boolean {
  return (
    previousMonthlyBase != null &&
    newMonthlyBase > previousMonthlyBase
  );
}

export function isPlanCreditDowngrade(
  previousMonthlyBase: number | null | undefined,
  newMonthlyBase: number,
): boolean {
  return (
    previousMonthlyBase != null &&
    newMonthlyBase < previousMonthlyBase
  );
}

export function shouldDeferDowngradeCreditSync(params: {
  planChanged: boolean;
  isNewPeriod: boolean;
  isDowngrade: boolean;
  downgradeEffectiveMode: string;
}): boolean {
  return (
    params.planChanged &&
    !params.isNewPeriod &&
    params.isDowngrade &&
    params.downgradeEffectiveMode === 'next_cycle'
  );
}

export function shouldDeferUpgradeCreditSync(params: {
  planChanged: boolean;
  isNewPeriod: boolean;
  isUpgrade: boolean;
  upgradeProrationMode: string;
}): boolean {
  return (
    params.planChanged &&
    !params.isNewPeriod &&
    params.isUpgrade &&
    params.upgradeProrationMode === 'next_cycle'
  );
}

export type UpgradeGrantResult = {
  grant: number;
  skipSync: boolean;
};

/** Base-credit grant for a mid-cycle upgrade (not a new billing period). */
export function resolveUpgradeMidCycleGrant(
  monthlyBase: number,
  remainingFraction: number | null | undefined,
  upgradeProrationMode: string,
): UpgradeGrantResult {
  if (upgradeProrationMode === 'next_cycle') {
    return { grant: 0, skipSync: true };
  }
  if (upgradeProrationMode === 'immediate_full') {
    return { grant: monthlyBase, skipSync: false };
  }
  if (upgradeProrationMode === 'immediate_prorated') {
    const fraction = remainingFraction;
    if (fraction != null && fraction > 0 && fraction < 1) {
      return {
        grant: Math.max(0, Math.ceil(monthlyBase * fraction)),
        skipSync: false,
      };
    }
    return { grant: monthlyBase, skipSync: false };
  }
  return { grant: monthlyBase, skipSync: false };
}

export function resolveNewPeriodBaseRemaining(
  monthlyBase: number,
  previousRemaining: number,
  policy: Pick<CreditPolicyConfigRow, 'base_carryover_enabled' | 'carryover_cap_credits'>,
): { totalRemaining: number; carried: number; forfeited: number } {
  const carried = computeCarriedBaseCredits(previousRemaining, policy);
  const forfeited = Math.max(0, previousRemaining - carried);
  return {
    totalRemaining: monthlyBase + carried,
    carried,
    forfeited,
  };
}

export function resolveImmediateDowngradeRemaining(
  previousRemaining: number,
  newMonthlyBase: number,
): number {
  return Math.min(Math.max(0, previousRemaining), Math.max(0, newMonthlyBase));
}

/** Keep DB subscription on the prior plan until renewal when downgrade is deferred. */
export function shouldRetainPriorPlanRecord(params: {
  planChanged: boolean;
  isNewPeriod: boolean;
  isDowngrade: boolean;
  downgradeEffectiveMode: string;
}): boolean {
  return (
    params.planChanged &&
    !params.isNewPeriod &&
    params.isDowngrade &&
    params.downgradeEffectiveMode === 'next_cycle'
  );
}

export function shouldDeferUpgradePlanChange(params: {
  changeKind: string;
  upgradeProrationMode: string;
}): boolean {
  return params.changeKind === 'upgrade' && params.upgradeProrationMode === 'next_cycle';
}

export function shouldDeferDowngradePlanChange(params: {
  changeKind: string;
  downgradeEffectiveMode: string;
}): boolean {
  return params.changeKind === 'downgrade' && params.downgradeEffectiveMode === 'next_cycle';
}
