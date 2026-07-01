import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeBillingPeriodRemainingFraction,
  computeCarriedBaseCredits,
  isPlanCreditDowngrade,
  isPlanCreditUpgrade,
  resolveImmediateDowngradeRemaining,
  resolveNewPeriodBaseRemaining,
  resolveUpgradeMidCycleGrant,
  shouldDeferDowngradeCreditSync,
  shouldDeferDowngradePlanChange,
  shouldDeferUpgradeCreditSync,
  shouldDeferUpgradePlanChange,
  shouldRetainPriorPlanRecord,
} from './credit-subscription-sync';

describe('computeCarriedBaseCredits', () => {
  it('returns 0 when carryover disabled', () => {
    assert.equal(
      computeCarriedBaseCredits(300, {
        base_carryover_enabled: false,
        carryover_cap_credits: null,
      }),
      0,
    );
  });

  it('returns full remaining when enabled and no cap', () => {
    assert.equal(
      computeCarriedBaseCredits(300, {
        base_carryover_enabled: true,
        carryover_cap_credits: null,
      }),
      300,
    );
  });

  it('applies cap when enabled', () => {
    assert.equal(
      computeCarriedBaseCredits(800, {
        base_carryover_enabled: true,
        carryover_cap_credits: 200,
      }),
      200,
    );
  });
});

describe('resolveUpgradeMidCycleGrant', () => {
  it('skips on next_cycle', () => {
    assert.deepEqual(
      resolveUpgradeMidCycleGrant(1000, 0.5, 'next_cycle'),
      { grant: 0, skipSync: true },
    );
  });

  it('grants full on immediate_full', () => {
    assert.deepEqual(
      resolveUpgradeMidCycleGrant(1000, 0.5, 'immediate_full'),
      { grant: 1000, skipSync: false },
    );
  });

  it('prorates on immediate_prorated', () => {
    assert.deepEqual(
      resolveUpgradeMidCycleGrant(1000, 0.5, 'immediate_prorated'),
      { grant: 500, skipSync: false },
    );
  });
});

describe('shouldDeferDowngradeCreditSync', () => {
  it('defers mid-cycle downgrade when policy is next_cycle', () => {
    assert.equal(
      shouldDeferDowngradeCreditSync({
        planChanged: true,
        isNewPeriod: false,
        isDowngrade: true,
        downgradeEffectiveMode: 'next_cycle',
      }),
      true,
    );
  });
});

describe('resolveNewPeriodBaseRemaining', () => {
  it('adds carried credits on top of new cycle grant', () => {
    const result = resolveNewPeriodBaseRemaining(500, 350, {
      base_carryover_enabled: true,
      carryover_cap_credits: 200,
    });
    assert.equal(result.carried, 200);
    assert.equal(result.forfeited, 150);
    assert.equal(result.totalRemaining, 700);
  });
});

describe('computeBillingPeriodRemainingFraction', () => {
  it('returns half when halfway through period', () => {
    const fraction = computeBillingPeriodRemainingFraction(0, 100, 50);
    assert.equal(fraction, 0.5);
  });
});

describe('plan change helpers', () => {
  it('detects upgrade and downgrade', () => {
    assert.equal(isPlanCreditUpgrade(500, 1000), true);
    assert.equal(isPlanCreditDowngrade(1000, 500), true);
  });

  it('caps remaining on immediate downgrade', () => {
    assert.equal(resolveImmediateDowngradeRemaining(800, 500), 500);
  });
});

describe('shouldRetainPriorPlanRecord', () => {
  it('retains prior plan on mid-cycle deferred downgrade', () => {
    assert.equal(
      shouldRetainPriorPlanRecord({
        planChanged: true,
        isNewPeriod: false,
        isDowngrade: true,
        downgradeEffectiveMode: 'next_cycle',
      }),
      true,
    );
  });
});

describe('shouldDeferUpgradePlanChange', () => {
  it('defers upgrade when mode is next_cycle', () => {
    assert.equal(
      shouldDeferUpgradePlanChange({
        changeKind: 'upgrade',
        upgradeProrationMode: 'next_cycle',
      }),
      true,
    );
  });
});

describe('shouldDeferDowngradePlanChange', () => {
  it('defers downgrade when mode is next_cycle', () => {
    assert.equal(
      shouldDeferDowngradePlanChange({
        changeKind: 'downgrade',
        downgradeEffectiveMode: 'next_cycle',
      }),
      true,
    );
  });
});
