export interface CreditWalletRow {
  id: string;
  organization_id: string;
  base_credits_in_cycle: number;
  base_credits_remaining: number;
  cycle_start: string | null;
  cycle_end: string | null;
  pack_credits_remaining: number;
  last_reset_at: string | null;
  last_consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditPackRow {
  id: string;
  pack_key: string;
  name: string;
  credits_amount: number;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  currency: string;
  unit_amount_cents: number | null;
  is_active: boolean;
  sort_order: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreditTransactionRow {
  id: string;
  organization_id: string;
  wallet_id: string | null;
  lot_id: string | null;
  tx_type: string;
  bucket_type: string;
  credits_delta: number;
  capability_key: string | null;
  reference_id: string | null;
  note: string | null;
  occurred_at: string;
  created_at: string;
}

export interface CapabilityCreditCostRow {
  capability_key: string;
  credits_cost: number;
  is_enabled: boolean;
  updated_at: string;
}

export interface CreditPolicyConfigRow {
  id: string;
  config_key: string;
  consumption_order: string;
  pack_expiry_days: number;
  base_carryover_enabled: boolean;
  pack_carryover_until_expiry: boolean;
  carryover_cap_credits: number | null;
  upgrade_proration_mode: string;
  downgrade_effective_mode: string;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationCreditWalletResponse {
  organization_id: string;
  base_credits_in_cycle: number;
  base_credits_remaining: number;
  pack_credits_remaining: number;
  total_credits_remaining: number;
  cycle_start: string | null;
  cycle_end: string | null;
  last_reset_at: string | null;
  last_consumed_at: string | null;
}

export interface CreditPackCatalogItem {
  pack_key: string;
  name: string;
  credits_amount: number;
  currency: string;
  unit_amount_cents: number | null;
}

export interface SyncCreditPacksFromStripeResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: { pack_key: string; message: string }[];
}

export interface CapabilityCreditCostAdminRow extends CapabilityCreditCostRow {
  display_name: string;
  description: string;
}
