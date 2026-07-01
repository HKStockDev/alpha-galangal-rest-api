import type { SubscriptionPricingModel } from '../billing/billing.types';

export interface SubscriptionPlanAdminRow {
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SyncPlansFromStripeResult {
  updated: number;
  unchanged: number;
  skipped: number;
  errors: { plan_key: string; message: string }[];
}

export type QuotaPeriod = 'day' | 'month' | 'lifetime';

export interface AiCapabilityRow {
  capability_key: string;
  display_name: string;
  description: string;
  is_mutating: boolean;
  default_requires_confirmation: boolean;
}

export interface EntitlementCell {
  id: string | null;
  plan_id: string;
  capability_key: string;
  is_enabled: boolean;
  hard_block: boolean;
  quota_period: QuotaPeriod | null;
  quota_limit: number | null;
  upsell_message: string | null;
  updated_at: string | null;
  updated_by_user_id: string | null;
}

export interface EntitlementMatrixRow {
  capability_key: string;
  display_name: string;
  description: string;
  is_mutating: boolean;
  cells: EntitlementCell[];
}

export interface EntitlementsMatrixResponse {
  plans: SubscriptionPlanAdminRow[];
  rows: EntitlementMatrixRow[];
}

export interface BulkEnableReadonlyResult {
  plans_updated: number;
  entitlements_upserted: number;
}

export interface CopyEntitlementsResult {
  entitlements_copied: number;
}

export interface OrgSubscriptionListItem {
  organization_id: string;
  organization_name: string;
  organization_stripe_customer_id: string | null;
  subscription_row_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: string;
  plan_key: string;
  plan_display_name: string | null;
  seat_quantity: number;
  current_period_end: string | null;
  updated_at: string;
}

export interface OrgSubscriptionPlanSummary {
  plan_key: string;
  display_name: string | null;
}

export interface OrgSubscriptionDetailBlock {
  id: string;
  status: string;
  seat_quantity: number;
  price_per_seat_cents: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  last_stripe_event_at: string | null;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: OrgSubscriptionPlanSummary;
}

export interface OrgSubscriptionDetailResponse {
  organization: {
    id: string;
    name: string;
    stripe_customer_id: string | null;
  };
  subscription: OrgSubscriptionDetailBlock | null;
}

export type StripeEventLogStatus = 'pending' | 'processed' | 'failed';

export interface StripeEventLogListItem {
  id: string;
  stripe_event_id: string;
  event_type: string;
  status: StripeEventLogStatus;
  received_at: string;
  processed_at: string | null;
  error_message: string | null;
}

export interface StripeEventLogDetail extends StripeEventLogListItem {
  payload: Record<string, unknown>;
}

export interface RetryStripeEventResult {
  id: string;
  stripe_event_id: string;
  status: StripeEventLogStatus;
  processed_at: string | null;
  error_message: string | null;
}

export type EntitlementPreviewReason =
  | 'allowed'
  | 'allowed_with_quota'
  | 'not_enabled'
  | 'hard_block';

export interface EntitlementPreviewResult {
  allowed: boolean;
  reason: EntitlementPreviewReason;
  upsell_message: string | null;
  plan: {
    id: string;
    plan_key: string;
    display_name: string | null;
  };
  capability: {
    capability_key: string;
    display_name: string;
    description: string;
  };
  entitlement: {
    is_enabled: boolean;
    hard_block: boolean;
    quota_period: QuotaPeriod | null;
    quota_limit: number | null;
    upsell_message: string | null;
  } | null;
}
