-- 20260516150000_phase2_subscription_plans_and_billing.sql
-- CON-102 Phase 2: Stripe catalog mapping in Postgres + org Stripe customer id.
--
-- 1) subscription_plans originally had UNIQUE(stripe_product_id), which blocks
--    multiple rows per Stripe Product (e.g. monthly + annual Prices). Drop that
--    uniqueness; keep stripe_price_id UNIQUE (one row per sellable Price).
-- 2) Seed subscription_plans rows aligned with marketing tiers (Professional /
--    Team / Enterprise) and Phase 1 illustrative USD amounts. stripe_* values are
--    PLACEHOLDERS — replace with real prod_/price_ IDs from Stripe Dashboard, e.g.:
--    UPDATE public.subscription_plans SET stripe_product_id = 'prod_...', stripe_price_id = 'price_...' WHERE plan_key = 'professional_annual';
-- 3) nullable stripe_customer_id on organizations for Checkout / Portal reuse.
-- 4) Idempotent entitlement backfill for newly inserted plans (same rules as
--    20260506160000_add_factor_capabilities_and_plan_entitlement_defaults.sql).

BEGIN;

-- ---------------------------------------------------------------------------
-- A) Schema: allow multiple subscription_plans rows per Stripe Product
-- ---------------------------------------------------------------------------

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_stripe_product_id_key;

CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_product_id
  ON public.subscription_plans (stripe_product_id);

-- ---------------------------------------------------------------------------
-- B) Organizations: persist Stripe Customer for Portal / repeat Checkout
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

COMMENT ON COLUMN public.organizations.stripe_customer_id IS
  'Stripe Customer id (cus_...) for this organization; set on first Checkout or provisioning.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_stripe_customer_id
  ON public.organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C) Seed subscription_plans (one row per sellable Stripe Price)
--    Cached cents match Phase 1 examples: Pro $2388/yr $249/mo; Team $1188/seat/yr $129/seat/mo;
--    Enterprise illustrative $25,000/yr flat.
-- ---------------------------------------------------------------------------

INSERT INTO public.subscription_plans (
  plan_key,
  stripe_product_id,
  stripe_price_id,
  display_name,
  billing_interval,
  currency,
  amount_cents,
  stripe_metadata,
  pricing_model,
  seat_based_enabled,
  unit_amount_cents,
  is_active
)
VALUES
  (
    'professional_annual',
    'prod_SEEDPH2REPLACE_PROFESSIONAL',
    'price_SEEDPH2REPLACE_PROFESSIONAL_ANNUAL',
    'Conviction — Professional (Annual)',
    'year',
    'usd',
    238800,
    jsonb_build_object(
      'tier', 'professional',
      'billing_cadence', 'annual',
      'product_description',
      'Single-seat research workspace with core screening: custom factor formulas, saved screens and watchlists, insider and political activity signals, 13F positioning overlays, and email support.',
      'price_note',
      'Illustrative $2,388/year flat (~$199/mo effective). Replace stripe IDs before production Checkout.'
    ),
    'flat',
    false,
    NULL,
    true
  ),
  (
    'professional_monthly',
    'prod_SEEDPH2REPLACE_PROFESSIONAL',
    'price_SEEDPH2REPLACE_PROFESSIONAL_MONTHLY',
    'Conviction — Professional (Monthly)',
    'month',
    'usd',
    24900,
    jsonb_build_object(
      'tier', 'professional',
      'billing_cadence', 'monthly',
      'product_description',
      'Single-seat research workspace with core screening: custom factor formulas, saved screens and watchlists, insider and political activity signals, 13F positioning overlays, and email support.',
      'price_note',
      'Illustrative $249/month flat. Replace stripe IDs before production Checkout.'
    ),
    'flat',
    false,
    NULL,
    true
  ),
  (
    'team_annual',
    'prod_SEEDPH2REPLACE_TEAM',
    'price_SEEDPH2REPLACE_TEAM_ANNUAL',
    'Conviction — Team (Annual, per seat)',
    'year',
    'usd',
    NULL,
    jsonb_build_object(
      'tier', 'team',
      'billing_cadence', 'annual',
      'product_description',
      'Multi-user workspace with everything in Professional, plus shared watchlists and models, organization-level tagging, collaboration, team activity visibility, and priority support. Billed per seat.',
      'price_note',
      'Illustrative $1,188/seat/year. Set Checkout quantity to seat count (policy cap e.g. 10 in app). Replace stripe IDs before production Checkout.'
    ),
    'per_seat',
    true,
    118800,
    true
  ),
  (
    'team_monthly',
    'prod_SEEDPH2REPLACE_TEAM',
    'price_SEEDPH2REPLACE_TEAM_MONTHLY',
    'Conviction — Team (Monthly, per seat)',
    'month',
    'usd',
    NULL,
    jsonb_build_object(
      'tier', 'team',
      'billing_cadence', 'monthly',
      'product_description',
      'Multi-user workspace with everything in Professional, plus shared watchlists and models, organization-level tagging, collaboration, team activity visibility, and priority support. Billed per seat.',
      'price_note',
      'Illustrative $129/seat/month. Replace stripe IDs before production Checkout.'
    ),
    'per_seat',
    true,
    12900,
    true
  ),
  (
    'enterprise_annual',
    'prod_SEEDPH2REPLACE_ENTERPRISE',
    'price_SEEDPH2REPLACE_ENTERPRISE_ANNUAL',
    'Conviction — Enterprise (Annual)',
    'year',
    'usd',
    2500000,
    jsonb_build_object(
      'tier', 'enterprise',
      'billing_cadence', 'annual',
      'product_description',
      'Institutional tier: everything in Team, plus advanced signal layers, priority onboarding, custom integrations, and dedicated success coverage. API access when available. Commercial terms often customized.',
      'price_note',
      'Illustrative $25,000/year flat; swap for contract-specific Stripe Price. Replace stripe IDs before production Checkout.'
    ),
    'flat',
    false,
    NULL,
    true
  )
ON CONFLICT (plan_key) DO NOTHING;

COMMENT ON TABLE public.subscription_plans IS
  'Local mapping of Stripe products/prices to internal plan identity for entitlements. Replace prod_SEEDPH2REPLACE_* / price_SEEDPH2REPLACE_* with real Stripe Dashboard ids via UPDATE; re-running this migration does not overwrite existing plan_key rows.';

-- ---------------------------------------------------------------------------
-- D) Idempotent factor entitlements for all active plans (backfill new rows)
-- ---------------------------------------------------------------------------

INSERT INTO public.subscription_plan_entitlements (
  plan_id,
  capability_key,
  is_enabled,
  quota_period,
  quota_limit,
  hard_block,
  upsell_message
)
SELECT
  p.id,
  'factor.read',
  true,
  NULL,
  NULL,
  false,
  NULL
FROM public.subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

INSERT INTO public.subscription_plan_entitlements (
  plan_id,
  capability_key,
  is_enabled,
  quota_period,
  quota_limit,
  hard_block,
  upsell_message
)
SELECT
  p.id,
  'factor.create',
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic') THEN false
    ELSE true
  END,
  NULL,
  NULL,
  false,
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic')
      THEN 'Upgrade your plan to create custom factors.'
    ELSE NULL
  END
FROM public.subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

INSERT INTO public.subscription_plan_entitlements (
  plan_id,
  capability_key,
  is_enabled,
  quota_period,
  quota_limit,
  hard_block,
  upsell_message
)
SELECT
  p.id,
  'factor.update',
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic') THEN false
    ELSE true
  END,
  NULL,
  NULL,
  false,
  CASE
    WHEN COALESCE(p.plan_key, '') IN ('starter', 'free', 'basic')
      THEN 'Upgrade your plan to update custom factors.'
    ELSE NULL
  END
FROM public.subscription_plans p
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

COMMIT;
