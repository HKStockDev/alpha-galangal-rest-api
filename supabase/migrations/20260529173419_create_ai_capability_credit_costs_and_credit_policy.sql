-- 20260529173419_create_ai_capability_credit_costs_and_credit_policy.sql
-- CON-155 / CON-156: per-capability credit cost + global policy config for renewals/proration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_capability_credit_costs (
  capability_key text PRIMARY KEY REFERENCES public.ai_capabilities(capability_key) ON DELETE CASCADE,
  credits_cost integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_capability_credit_costs_nonnegative CHECK (credits_cost >= 0)
);

COMMENT ON TABLE public.ai_capability_credit_costs IS
  'How many credits each capability consumes per successful execution.';

DROP TRIGGER IF EXISTS trg_ai_capability_credit_costs_set_updated_at ON public.ai_capability_credit_costs;
CREATE TRIGGER trg_ai_capability_credit_costs_set_updated_at
  BEFORE UPDATE ON public.ai_capability_credit_costs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Single-row global credit policy for MVP.
CREATE TABLE IF NOT EXISTS public.ai_credit_policy_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL UNIQUE DEFAULT 'default',

  -- Consumption: base first, then pack lot by earliest expiry.
  consumption_order text NOT NULL DEFAULT 'base_then_pack_fifo_expiry',

  -- Pack expiry policy (12 months recommended).
  pack_expiry_days integer NOT NULL DEFAULT 365,

  -- Carryover policy:
  -- base credits do NOT carry; pack credits carry until expiry.
  base_carryover_enabled boolean NOT NULL DEFAULT false,
  pack_carryover_until_expiry boolean NOT NULL DEFAULT true,
  carryover_cap_credits integer, -- NULL = no cap

  -- Plan change behavior:
  -- upgrade applies immediately with prorated base grant;
  -- downgrade takes effect next cycle.
  upgrade_proration_mode text NOT NULL DEFAULT 'immediate_prorated',
  downgrade_effective_mode text NOT NULL DEFAULT 'next_cycle',

  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_credit_policy_config_consumption_order_check
    CHECK (consumption_order IN ('base_then_pack_fifo_expiry')),
  CONSTRAINT ai_credit_policy_config_pack_expiry_positive
    CHECK (pack_expiry_days > 0),
  CONSTRAINT ai_credit_policy_config_carryover_cap_nonnegative
    CHECK (carryover_cap_credits IS NULL OR carryover_cap_credits >= 0),
  CONSTRAINT ai_credit_policy_config_upgrade_proration_check
    CHECK (upgrade_proration_mode IN ('immediate_prorated', 'immediate_full', 'next_cycle')),
  CONSTRAINT ai_credit_policy_config_downgrade_effective_check
    CHECK (downgrade_effective_mode IN ('next_cycle', 'immediate'))
);

COMMENT ON TABLE public.ai_credit_policy_config IS
  'Global policy for credit consumption order, pack expiry, carryover, and plan-change behavior.';

DROP TRIGGER IF EXISTS trg_ai_credit_policy_config_set_updated_at ON public.ai_credit_policy_config;
CREATE TRIGGER trg_ai_credit_policy_config_set_updated_at
  BEFORE UPDATE ON public.ai_credit_policy_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_credit_policy_config (
  config_key,
  consumption_order,
  pack_expiry_days,
  base_carryover_enabled,
  pack_carryover_until_expiry,
  carryover_cap_credits,
  upgrade_proration_mode,
  downgrade_effective_mode
)
VALUES (
  'default',
  'base_then_pack_fifo_expiry',
  365,
  false,
  true,
  NULL,
  'immediate_prorated',
  'next_cycle'
)
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
