BEGIN;

CREATE TABLE IF NOT EXISTS public.political_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  politician_id uuid NOT NULL REFERENCES public.politicians(id) ON DELETE CASCADE,
  security_id uuid NOT NULL REFERENCES public.securities(id) ON DELETE CASCADE,

  trade_date date NOT NULL,
  disclosure_date date,

  side text NOT NULL CHECK (side IN ('buy', 'sell')),

  value_usd numeric,
  value_usd_low numeric,
  value_usd_high numeric,

  source text NOT NULL DEFAULT 'fmp_senate',
  external_id text NOT NULL,
 
  raw jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT political_trades_external_id_uk UNIQUE (external_id)
);

CREATE INDEX IF NOT EXISTS ix_political_trades_security_trade_date
  ON public.political_trades (security_id, trade_date DESC);

CREATE INDEX IF NOT EXISTS ix_political_trades_trade_date
  ON public.political_trades (trade_date DESC);

CREATE INDEX IF NOT EXISTS ix_political_trades_politician_id
  ON public.political_trades (politician_id);

COMMIT;
