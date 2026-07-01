export type SubscriptionPricingModel = 'flat' | 'per_seat';

export interface SubscriptionPlanRow {
  id: string;
  plan_key: string;
  stripe_product_id: string;
  stripe_price_id: string;
  display_name: string | null;
  billing_interval: string | null;
  currency: string | null;
  amount_cents: number | null;
  pricing_model: SubscriptionPricingModel;
  seat_based_enabled: boolean;
  unit_amount_cents: number | null;
  monthly_base_credits?: number;
  is_active: boolean;
}

export interface OrganizationBillingRow {
  id: string;
  name: string;
  stripe_customer_id: string | null;
  trial_used_at: string | null;
}

/** Public catalog row for org billing pricing UI (no Stripe secrets). */
export interface BillingPlanCatalogItem {
  plan_key: string;
  display_name: string | null;
  billing_interval: string | null;
  currency: string | null;
  amount_cents: number | null;
  unit_amount_cents: number | null;
  pricing_model: SubscriptionPricingModel;
  seat_based_enabled: boolean;
  tier: 'professional' | 'team' | 'enterprise';
}

/** GET billing status — subscription truth from webhook-synced DB rows. */
export interface OrganizationBillingStatus {
  organization_id: string;
  has_stripe_customer: boolean;
  subscription: {
    status: string;
    plan_key: string;
    plan_display_name: string | null;
    seat_quantity: number;
    current_period_end: string | null;
    trial_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  /** True when DB has an active-like subscription (trialing, active, past_due). */
  is_entitled: boolean;
  /** True when Checkout/Portal can run (Stripe customer exists or subscription row present). */
  can_manage_in_stripe: boolean;
  /** True when org may start CON-168 free-trial Checkout (one trial per org lifetime). */
  free_trial_available: boolean;
}

/** Platform-admin readiness check for CON-98 S1 (Stripe + catalog + webhooks). */
export interface BillingSetupStatus {
  stripe_secret_key_configured: boolean;
  stripe_webhook_secret_configured: boolean;
  checkout_urls_configured: boolean;
  active_plan_count: number;
  plans_with_placeholder_stripe_ids: string[];
  checkout_ready: boolean;
  webhook_ready: boolean;
  portal_configuration_id: string | null;
  portal_subscription_update_enabled: boolean;
  /** Sellable plans in subscription_plans (products/prices), same counts as POST /billing/setup/sync-portal. */
  portal_product_count: number;
  portal_price_count: number;
  portal_switch_ready: boolean;
  /** Human-readable blockers for operators. */
  blockers: string[];
}
