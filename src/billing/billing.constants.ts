/** Matches seed migrations until real Stripe Dashboard ids are applied. */
export const STRIPE_PLAN_PLACEHOLDER_MARKER = 'SEEDPH2REPLACE';

export const BILLING_PORTAL_FLOWS = [
  /** Full portal home (all enabled features on the default configuration). */
  'home',
  /** CON-154: portal configuration with invoice history only. */
  'invoice_history',
  'payment_method_update',
  'subscription_cancel',
  'subscription_update',
] as const;

export type BillingPortalFlow = (typeof BILLING_PORTAL_FLOWS)[number];

/** Plan used for CON-168 free-trial Checkout (must be a real Stripe Price in subscription_plans). */
export const TRIAL_ENTRY_PLAN_KEY = 'professional_monthly';

/** Active subscription statuses that block starting trial checkout (separate from lifetime trial_used_at). */
export const TRIAL_BLOCKING_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due'] as const;
