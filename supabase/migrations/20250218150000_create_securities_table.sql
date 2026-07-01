CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.securities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  ticker text NOT NULL,
  market text NOT NULL,
  locale text NOT NULL,
  name text NOT NULL,

  ticker_root text,
  ticker_suffix text,

  cik text,
  composite_figi text,
  share_class_figi text,

  type_code text NOT NULL,
  type_description text,

  description text,
  homepage_url text,
  phone_number text,
  total_employees integer,
  list_date date,
  primary_exchange text,
  currency_name text,

  sic_code integer,
  sic_description text,

  market_cap numeric(20,2),
  share_class_shares_outstanding numeric(20,4),
  weighted_shares_outstanding numeric(20,4),
  round_lot integer,

  active boolean NOT NULL DEFAULT true,
  delisted_utc timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT securities_ticker_nonempty CHECK (length(btrim(ticker)) > 0),
  CONSTRAINT securities_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT securities_market_chk CHECK (
    market IN ('stocks','crypto','fx','indices','options')
  ),
  CONSTRAINT securities_locale_chk CHECK (
    locale IN ('us','global')
  ),
  CONSTRAINT securities_employees_chk CHECK (total_employees IS NULL OR total_employees >= 0),
  CONSTRAINT securities_round_lot_chk CHECK (round_lot IS NULL OR round_lot > 0),
  CONSTRAINT securities_market_cap_chk CHECK (market_cap IS NULL OR market_cap >= 0),
  CONSTRAINT securities_shares_chk CHECK (
    (share_class_shares_outstanding IS NULL OR share_class_shares_outstanding >= 0)
    AND
    (weighted_shares_outstanding IS NULL OR weighted_shares_outstanding >= 0)
  ),
  CONSTRAINT securities_delisted_active_chk CHECK (
    delisted_utc IS NULL OR active IN (false, true)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS securities_market_locale_ticker_uq
  ON public.securities (market, locale, ticker);

CREATE UNIQUE INDEX IF NOT EXISTS securities_composite_figi_uq
  ON public.securities (composite_figi)
  WHERE composite_figi IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS securities_share_class_figi_uq
  ON public.securities (share_class_figi)
  WHERE share_class_figi IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS securities_us_stocks_cik_uq
  ON public.securities (cik)
  WHERE cik IS NOT NULL AND market = 'stocks' AND locale = 'us';

CREATE INDEX IF NOT EXISTS securities_type_code_idx ON public.securities (type_code);
CREATE INDEX IF NOT EXISTS securities_primary_exchange_idx ON public.securities (primary_exchange);
CREATE INDEX IF NOT EXISTS securities_sic_code_idx ON public.securities (sic_code);
CREATE INDEX IF NOT EXISTS securities_market_cap_idx ON public.securities (market_cap);
CREATE INDEX IF NOT EXISTS securities_active_idx ON public.securities (active);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_securities_set_updated_at ON public.securities;
CREATE TRIGGER trg_securities_set_updated_at
  BEFORE UPDATE ON public.securities
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();
