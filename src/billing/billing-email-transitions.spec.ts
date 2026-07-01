import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  billingNotificationDedupeKey,
  detectBillingNotificationTransitions,
} from './billing-email-transitions';
import { SubscriptionPlanRow } from './billing.types';

const professionalPlan: SubscriptionPlanRow = {
  id: 'plan-pro',
  plan_key: 'professional_monthly',
  stripe_product_id: 'prod_pro',
  stripe_price_id: 'price_pro',
  display_name: 'Professional',
  billing_interval: 'month',
  currency: 'usd',
  amount_cents: 24900,
  pricing_model: 'flat',
  seat_based_enabled: false,
  unit_amount_cents: null,
  monthly_base_credits: 1000,
  is_active: true,
};

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
  monthly_base_credits: 5000,
  is_active: true,
};

describe('detectBillingNotificationTransitions', () => {
  it('emits subscription_purchased on new active subscription', () => {
    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: true,
      previous: null,
      next: { status: 'active', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      previousPlan: null,
      nextPlan: professionalPlan,
      seatQuantity: 1,
    });
    assert.deepEqual(transitions, ['subscription_purchased']);
  });

  it('does not emit subscription_purchased for new trialing subscription', () => {
    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: true,
      previous: null,
      next: { status: 'trialing', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      previousPlan: null,
      nextPlan: professionalPlan,
      seatQuantity: 1,
    });
    assert.deepEqual(transitions, []);
  });

  it('emits trial_ended when status moves from trialing to active', () => {
    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: false,
      previous: { status: 'trialing', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      next: { status: 'active', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      previousPlan: professionalPlan,
      nextPlan: professionalPlan,
      seatQuantity: 1,
    });
    assert.deepEqual(transitions, ['trial_ended']);
  });

  it('emits subscription_cancelled when status becomes canceled', () => {
    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: false,
      previous: { status: 'active', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      next: { status: 'canceled', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      previousPlan: professionalPlan,
      nextPlan: professionalPlan,
      seatQuantity: 1,
    });
    assert.deepEqual(transitions, ['subscription_cancelled']);
  });

  it('emits subscription_cancelled when cancel_at_period_end is scheduled', () => {
    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: false,
      previous: { status: 'active', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      next: { status: 'active', planId: professionalPlan.id, cancelAtPeriodEnd: true },
      previousPlan: professionalPlan,
      nextPlan: professionalPlan,
      seatQuantity: 1,
    });
    assert.deepEqual(transitions, ['subscription_cancelled']);
  });

  it('emits subscription_upgraded on tier upgrade', () => {
    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: false,
      previous: { status: 'active', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      next: { status: 'active', planId: teamPlan.id, cancelAtPeriodEnd: false },
      previousPlan: professionalPlan,
      nextPlan: teamPlan,
      seatQuantity: 1,
    });
    assert.deepEqual(transitions, ['subscription_upgraded']);
  });

  it('does not emit subscription_upgraded on downgrade', () => {
    const transitions = detectBillingNotificationTransitions({
      isNewSubscription: false,
      previous: { status: 'active', planId: teamPlan.id, cancelAtPeriodEnd: false },
      next: { status: 'active', planId: professionalPlan.id, cancelAtPeriodEnd: false },
      previousPlan: teamPlan,
      nextPlan: professionalPlan,
      seatQuantity: 1,
    });
    assert.deepEqual(transitions, []);
  });
});

describe('billingNotificationDedupeKey', () => {
  it('builds stable dedupe key', () => {
    assert.equal(
      billingNotificationDedupeKey('subscription_purchased', 'evt_123'),
      'subscription_purchased:evt_123',
    );
  });
});
