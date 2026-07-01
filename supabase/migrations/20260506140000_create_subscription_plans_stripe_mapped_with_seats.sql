-- 20260506140000_create_subscription_plans_stripe_mapped_with_seats.sql
-- Stripe-mapped plans for hosted Checkout/Portal MVP, including seat-pricing metadata.

BEGIN;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text UNIQUE,

  -- Stripe source-of-truth mapping
  stripe_product_id text NOT NULL UNIQUE,
  stripe_price_id text NOT NULL UNIQUE,

  -- Cached display/pricing metadata (read-only in app)
  display_name text,
  billing_interval text,
  currency text,
  amount_cents integer,
  stripe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Seat pricing model metadata
  pricing_model text NOT NULL DEFAULT 'flat',
  seat_based_enabled boolean NOT NULL DEFAULT false,
  unit_amount_cents integer,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_plans_billing_interval_check
    CHECK (billing_interval IS NULL OR billing_interval IN ('day', 'week', 'month', 'year', 'one_time')),
  CONSTRAINT subscription_plans_amount_cents_nonnegative
    CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CONSTRAINT subscription_plans_unit_amount_cents_nonnegative
    CHECK (unit_amount_cents IS NULL OR unit_amount_cents >= 0),
  CONSTRAINT subscription_plans_pricing_model_check
    CHECK (pricing_model IN ('flat', 'per_seat'))
);

COMMENT ON TABLE public.subscription_plans IS
  'Local mapping of Stripe products/prices to internal plan identity for entitlements.';
COMMENT ON COLUMN public.subscription_plans.pricing_model IS
  'Pricing mode for this Stripe price: flat or per_seat.';
COMMENT ON COLUMN public.subscription_plans.seat_based_enabled IS
  'Convenience flag for UI/logic when the plan is seat-based.';
COMMENT ON COLUMN public.subscription_plans.unit_amount_cents IS
  'Cached Stripe unit amount. For per-seat pricing, this is amount per seat.';

DROP TRIGGER IF EXISTS trg_subscription_plans_set_updated_at ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_set_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_subscription_plans_plan_key
  ON public.subscription_plans(plan_key);

COMMIT;
