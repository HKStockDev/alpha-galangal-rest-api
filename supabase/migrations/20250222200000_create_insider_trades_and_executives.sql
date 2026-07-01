-- Replace prior design: insiders (person-at-company with role) + insider_trades (FK to insiders).
-- Drops old executives and old insider_trades if present so this migration is idempotent.

BEGIN;

DROP TABLE IF EXISTS public.insider_trades;
DROP TABLE IF EXISTS public.executives;

DO $$
BEGIN
  CREATE TYPE public.insider_role AS ENUM (
    'CEO',
    'CFO',
    'DIRECTOR',
    'CHAIRMAN',
    'FOUNDER',
    'TEN_PERCENT_OWNER',
    'OTHER_EXECUTIVE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.insiders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  person_entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,

  role public.insider_role NOT NULL,
  title text,
  reporting_cik text,
  linkedin_url text,
  display_order int,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_insiders_company_person UNIQUE (company_entity_id, person_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_insiders_reporting_cik ON public.insiders(reporting_cik) WHERE reporting_cik IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insiders_company ON public.insiders(company_entity_id);
CREATE INDEX IF NOT EXISTS idx_insiders_person ON public.insiders(person_entity_id);

CREATE TRIGGER trg_insiders_set_updated_at
  BEFORE UPDATE ON public.insiders
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.insider_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insider_id uuid NOT NULL REFERENCES public.insiders(id) ON DELETE CASCADE,

  transaction_type text NOT NULL,
  transaction_type_raw text,
  acquisition_or_disposition text,
  direct_or_indirect text,
  shares numeric(20, 4) NOT NULL,
  securities_owned_after numeric(20, 4),
  price_usd numeric(20, 4),
  value_usd numeric(20, 2),
  security_name text,
  trade_date date NOT NULL,
  filing_date date,
  form_type text,
  filing_url text,
  source text NOT NULL DEFAULT 'fmp',
  filing_id text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_insider_trades_type CHECK (transaction_type IN ('buy', 'sell', 'option_exercise', 'gift', 'other')),
  CONSTRAINT chk_insider_trades_acq_disp CHECK (acquisition_or_disposition IS NULL OR acquisition_or_disposition IN ('A', 'D')),
  CONSTRAINT chk_insider_trades_direct CHECK (direct_or_indirect IS NULL OR direct_or_indirect IN ('D', 'I'))
);

CREATE INDEX IF NOT EXISTS idx_insider_trades_insider ON public.insider_trades(insider_id);
CREATE INDEX IF NOT EXISTS idx_insider_trades_trade_date ON public.insider_trades(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_insider_trades_insider_date ON public.insider_trades(insider_id, trade_date DESC);

COMMIT;
