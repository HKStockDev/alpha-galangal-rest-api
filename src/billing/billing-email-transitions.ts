import { classifyPlanChange, PlanChangeKind } from './billing-plan-change';
import { SubscriptionPlanRow } from './billing.types';

export type BillingSubscriptionSnapshot = {
  status: string;
  planId: string | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingNotificationTransition =
  | 'subscription_purchased'
  | 'subscription_cancelled'
  | 'subscription_upgraded'
  | 'trial_ended';

export type DetectBillingNotificationTransitionsParams = {
  isNewSubscription: boolean;
  previous: BillingSubscriptionSnapshot | null;
  next: BillingSubscriptionSnapshot;
  previousPlan: SubscriptionPlanRow | null;
  nextPlan: SubscriptionPlanRow;
  seatQuantity: number;
};

export function detectBillingNotificationTransitions(
  params: DetectBillingNotificationTransitionsParams,
): BillingNotificationTransition[] {
  const transitions: BillingNotificationTransition[] = [];
  const { isNewSubscription, previous, next, previousPlan, nextPlan, seatQuantity } = params;

  if (isNewSubscription && next.status === 'active') {
    transitions.push('subscription_purchased');
    return transitions;
  }

  if (!previous) {
    return transitions;
  }

  if (previous.status === 'trialing' && next.status === 'active') {
    transitions.push('trial_ended');
  }

  const becameCancelled = next.status === 'canceled' && previous.status !== 'canceled';
  const scheduledCancel =
    next.cancelAtPeriodEnd && !previous.cancelAtPeriodEnd && next.status !== 'canceled';

  if (becameCancelled || scheduledCancel) {
    transitions.push('subscription_cancelled');
  }

  const planChanged = Boolean(previous.planId && next.planId && previous.planId !== next.planId);
  if (planChanged && previousPlan) {
    const changeKind: PlanChangeKind = classifyPlanChange(
      previousPlan,
      nextPlan,
      seatQuantity,
      seatQuantity,
    );
    if (changeKind === 'upgrade' || changeKind === 'interval_change') {
      transitions.push('subscription_upgraded');
    }
  }

  return transitions;
}

export function billingNotificationDedupeKey(
  transition: BillingNotificationTransition,
  stripeEventId: string,
): string {
  return `${transition}:${stripeEventId}`;
}
