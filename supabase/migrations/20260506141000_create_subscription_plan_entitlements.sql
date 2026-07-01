-- 20260506141000_create_subscription_plan_entitlements.sql
-- Capability entitlements per Stripe-mapped plan.

BEGIN;

CREATE TABLE IF NOT EXISTS public.subscription_plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  capability_key text NOT NULL REFERENCES public.ai_capabilities(capability_key) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT false,
  quota_period text,
  quota_limit integer,
  hard_block boolean NOT NULL DEFAULT false,
  upsell_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_plan_entitlements_quota_period_check
    CHECK (quota_period IS NULL OR quota_period IN ('day', 'month', 'lifetime')),
  CONSTRAINT subscription_plan_entitlements_quota_limit_positive
    CHECK (quota_limit IS NULL OR quota_limit >= 0),
  CONSTRAINT uq_subscription_plan_entitlements_plan_capability
    UNIQUE (plan_id, capability_key)
);

DROP TRIGGER IF EXISTS trg_subscription_plan_entitlements_set_updated_at ON public.subscription_plan_entitlements;
CREATE TRIGGER trg_subscription_plan_entitlements_set_updated_at
  BEFORE UPDATE ON public.subscription_plan_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_subscription_plan_entitlements_capability
  ON public.subscription_plan_entitlements(capability_key);

COMMIT;
