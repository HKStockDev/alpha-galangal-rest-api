-- 20260506142000_create_organization_subscriptions_stripe_with_seats.sql
-- Organization -> Stripe subscription state + seat quantity snapshot.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,

  stripe_customer_id text NOT NULL,
  stripe_subscription_id text NOT NULL UNIQUE,

  status text NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  trial_end timestamptz,

  -- Seat-based pricing support
  seat_quantity integer NOT NULL DEFAULT 1,
  price_per_seat_cents integer,
  minimum_seats integer,
  included_seats integer,

  last_stripe_event_at timestamptz,
  stripe_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  CONSTRAINT organization_subscriptions_seat_quantity_positive
    CHECK (seat_quantity > 0),
  CONSTRAINT organization_subscriptions_price_per_seat_nonnegative
    CHECK (price_per_seat_cents IS NULL OR price_per_seat_cents >= 0),
  CONSTRAINT organization_subscriptions_minimum_seats_positive
    CHECK (minimum_seats IS NULL OR minimum_seats > 0),
  CONSTRAINT organization_subscriptions_included_seats_nonnegative
    CHECK (included_seats IS NULL OR included_seats >= 0)
);

COMMENT ON TABLE public.organization_subscriptions IS
  'Current Stripe subscription state per organization used for entitlement resolution.';
COMMENT ON COLUMN public.organization_subscriptions.seat_quantity IS
  'Current billed seat quantity from Stripe subscription items.';
COMMENT ON COLUMN public.organization_subscriptions.price_per_seat_cents IS
  'Cached unit amount per seat for display/audit.';

DROP TRIGGER IF EXISTS trg_organization_subscriptions_set_updated_at ON public.organization_subscriptions;
CREATE TRIGGER trg_organization_subscriptions_set_updated_at
  BEFORE UPDATE ON public.organization_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_org
  ON public.organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_status
  ON public.organization_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_customer
  ON public.organization_subscriptions(stripe_customer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_subscriptions_one_active_like
  ON public.organization_subscriptions(organization_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'incomplete', 'unpaid', 'paused');

COMMIT;
