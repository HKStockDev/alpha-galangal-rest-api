import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPerSeatPlan, resolveSeatSyncStripeParams } from './billing-seat-sync';
import { SubscriptionPlanRow } from './billing.types';

const teamPlan: SubscriptionPlanRow = {
  id: 'plan-team',
  plan_key: 'team_monthly',
  stripe_product_id: 'prod_team',
  stripe_price_id: 'price_team',
  display_name: 'Team',
  billing_interval: 'month',
  currency: 'usd',
  amount_cents: null,
  pricing_model: 'per_seat',
  seat_based_enabled: true,
  unit_amount_cents: 12900,
  is_active: true,
};

const professionalPlan: SubscriptionPlanRow = {
  ...teamPlan,
  id: 'plan-pro',
  plan_key: 'professional_monthly',
  stripe_price_id: 'price_pro',
  pricing_model: 'flat',
  seat_based_enabled: false,
  amount_cents: 24900,
  unit_amount_cents: null,
};

describe('isPerSeatPlan', () => {
  it('returns true for per_seat pricing_model', () => {
    assert.equal(isPerSeatPlan(teamPlan), true);
  });

  it('returns false for flat professional plan', () => {
    assert.equal(isPerSeatPlan(professionalPlan), false);
  });
});

describe('resolveSeatSyncStripeParams', () => {
  it('uses upgrade proration when seat quantity increases', () => {
    const { changeKind, stripeParams } = resolveSeatSyncStripeParams(teamPlan, 1, 3);
    assert.equal(changeKind, 'upgrade');
    assert.equal(stripeParams.proration_behavior, 'create_prorations');
    assert.equal(stripeParams.billing_cycle_anchor, 'unchanged');
  });

  it('uses downgrade proration when seat quantity decreases', () => {
    const { changeKind, stripeParams } = resolveSeatSyncStripeParams(teamPlan, 3, 1);
    assert.equal(changeKind, 'downgrade');
    assert.equal(stripeParams.proration_behavior, 'none');
    assert.equal(stripeParams.billing_cycle_anchor, 'unchanged');
  });

  it('no-ops at Stripe layer when quantity unchanged (upgrade kind for equal cents)', () => {
    const { changeKind, stripeParams } = resolveSeatSyncStripeParams(teamPlan, 2, 2);
    assert.equal(changeKind, 'upgrade');
    assert.equal(stripeParams.proration_behavior, 'create_prorations');
  });
});
