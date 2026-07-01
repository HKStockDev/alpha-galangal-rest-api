-- 20260529173359_create_organization_credit_wallets.sql
-- CON-155 / CON-158: per-org wallet state (base monthly bucket + pack bucket snapshot).

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_credit_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Monthly/base credits (resets each billing cycle; no carryover).
  base_credits_in_cycle integer NOT NULL DEFAULT 0,
  base_credits_remaining integer NOT NULL DEFAULT 0,
  cycle_start timestamptz,
  cycle_end timestamptz,

  -- Aggregate purchased pack balance snapshot (carry until lot expiry).
  pack_credits_remaining integer NOT NULL DEFAULT 0,

  -- Audit/reconciliation
  last_reset_at timestamptz,
  last_consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_credit_wallets_base_nonnegative CHECK (base_credits_in_cycle >= 0),
  CONSTRAINT organization_credit_wallets_base_remaining_nonnegative CHECK (base_credits_remaining >= 0),
  CONSTRAINT organization_credit_wallets_pack_remaining_nonnegative CHECK (pack_credits_remaining >= 0)
);

COMMENT ON TABLE public.organization_credit_wallets IS
  'Current credit balances per organization: monthly base bucket + aggregate pack bucket.';

DROP TRIGGER IF EXISTS trg_organization_credit_wallets_set_updated_at ON public.organization_credit_wallets;
CREATE TRIGGER trg_organization_credit_wallets_set_updated_at
  BEFORE UPDATE ON public.organization_credit_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMIT;
