-- 20260529173349_create_credit_packs.sql
-- CON-155 / CON-159: sellable credit pack catalog.

BEGIN;

CREATE TABLE IF NOT EXISTS public.credit_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_key text NOT NULL UNIQUE,
  name text NOT NULL,
  credits_amount integer NOT NULL,
  stripe_product_id text,
  stripe_price_id text,
  currency text NOT NULL DEFAULT 'usd',
  unit_amount_cents integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_packs_credits_amount_positive CHECK (credits_amount > 0),
  CONSTRAINT credit_packs_unit_amount_nonnegative CHECK (unit_amount_cents IS NULL OR unit_amount_cents >= 0)
);

COMMENT ON TABLE public.credit_packs IS
  'Catalog of add-on credit packs organizations can purchase.';

DROP TRIGGER IF EXISTS trg_credit_packs_set_updated_at ON public.credit_packs;
CREATE TRIGGER trg_credit_packs_set_updated_at
  BEFORE UPDATE ON public.credit_packs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_credit_packs_active_sort
  ON public.credit_packs(is_active, sort_order);

COMMIT;
