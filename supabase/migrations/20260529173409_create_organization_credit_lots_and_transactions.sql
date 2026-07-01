-- 20260529173409_create_organization_credit_lots_and_transactions.sql
-- CON-155 / CON-157: credit lots (pack expiry/FIFO by expiry) + immutable ledger.

BEGIN;

-- Pack purchases are tracked as lots so expiry and consumption ordering are deterministic.
CREATE TABLE IF NOT EXISTS public.organization_credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  credit_pack_id uuid NOT NULL REFERENCES public.credit_packs(id) ON DELETE RESTRICT,
  purchased_credits integer NOT NULL,
  remaining_credits integer NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  stripe_checkout_session_id text,
  stripe_invoice_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_credit_lots_purchased_positive CHECK (purchased_credits > 0),
  CONSTRAINT organization_credit_lots_remaining_nonnegative CHECK (remaining_credits >= 0),
  CONSTRAINT organization_credit_lots_remaining_lte_purchased CHECK (remaining_credits <= purchased_credits)
);

COMMENT ON TABLE public.organization_credit_lots IS
  'Purchased credit lots that can carry across cycles until expiry. Consume oldest-expiring lot first.';

DROP TRIGGER IF EXISTS trg_organization_credit_lots_set_updated_at ON public.organization_credit_lots;
CREATE TRIGGER trg_organization_credit_lots_set_updated_at
  BEFORE UPDATE ON public.organization_credit_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Key query index for consumption order: earliest-expiring non-empty lots first.
CREATE INDEX IF NOT EXISTS idx_credit_lots_org_expiry_remaining
  ON public.organization_credit_lots(organization_id, expires_at, id)
  WHERE remaining_credits > 0;

CREATE INDEX IF NOT EXISTS idx_credit_lots_org_purchase_time
  ON public.organization_credit_lots(organization_id, purchased_at DESC);

-- Immutable ledger for all credit movements.
CREATE TABLE IF NOT EXISTS public.organization_credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  wallet_id uuid REFERENCES public.organization_credit_wallets(id) ON DELETE SET NULL,
  lot_id uuid REFERENCES public.organization_credit_lots(id) ON DELETE SET NULL,

  tx_type text NOT NULL,               -- purchase | consume | refund | adjust | expire | base_grant | base_reset
  bucket_type text NOT NULL,           -- base | pack
  credits_delta integer NOT NULL,      -- positive or negative
  capability_key text REFERENCES public.ai_capabilities(capability_key) ON DELETE SET NULL,

  reference_id text,                   -- request id / session id / invoice id / webhook id
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_credit_transactions_tx_type_check
    CHECK (tx_type IN ('purchase', 'consume', 'refund', 'adjust', 'expire', 'base_grant', 'base_reset')),
  CONSTRAINT organization_credit_transactions_bucket_type_check
    CHECK (bucket_type IN ('base', 'pack')),
  CONSTRAINT organization_credit_transactions_nonzero_delta
    CHECK (credits_delta <> 0)
);

COMMENT ON TABLE public.organization_credit_transactions IS
  'Immutable ledger for base and pack credit changes; source of truth for audit/reconciliation.';

CREATE INDEX IF NOT EXISTS idx_credit_transactions_org_time
  ON public.organization_credit_transactions(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference
  ON public.organization_credit_transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_capability
  ON public.organization_credit_transactions(capability_key, occurred_at DESC);

COMMIT;
