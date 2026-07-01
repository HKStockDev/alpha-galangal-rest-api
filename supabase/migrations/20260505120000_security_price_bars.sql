-- Cached OHLCV / line bars from FMP for stock charts.
-- Intervals:
--   '5min'  → 1D chart  (FMP /api/v3/historical-chart/5min/{symbol})
--   '15min' → 5D chart  (FMP /api/v3/historical-chart/15min/{symbol})
--   '1d'    → 1M..MAX   (FMP /api/v3/historical-price-full/{symbol}?serietype=line)
--
-- open/high/low are NULL for '1d' bars because the serietype=line endpoint
-- only returns date + close. close is always present.

CREATE TABLE IF NOT EXISTS public.security_price_bars (
  security_id uuid       NOT NULL REFERENCES public.securities (id) ON DELETE CASCADE,
  interval    text       NOT NULL,
  bar_start   timestamptz NOT NULL,

  -- Intraday (5min / 15min) → all four present.
  -- Daily line (1d)         → open / high / low are NULL; only close is stored.
  open        numeric,
  high        numeric,
  low         numeric,
  close       numeric    NOT NULL,
  volume      bigint,

  source      text       NOT NULL DEFAULT 'fmp',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT security_price_bars_interval_chk CHECK (
    interval IN ('5min', '15min', '1d')
  ),
  CONSTRAINT security_price_bars_volume_chk CHECK (volume IS NULL OR volume >= 0),
  -- OHLC relationship enforced only when intraday fields are present.
  CONSTRAINT security_price_bars_ohlc_chk CHECK (
    high IS NULL OR (
      high >= low
      AND high >= open
      AND high >= close
      AND low  <= open
      AND low  <= close
    )
  ),

  PRIMARY KEY (security_id, interval, bar_start)
);

CREATE INDEX IF NOT EXISTS security_price_bars_lookup_idx
  ON public.security_price_bars (security_id, interval, bar_start DESC);

DROP TRIGGER IF EXISTS trg_security_price_bars_set_updated_at ON public.security_price_bars;
CREATE TRIGGER trg_security_price_bars_set_updated_at
  BEFORE UPDATE ON public.security_price_bars
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.security_price_bars IS
  'Time-series price bars from FMP. '
  'Intraday (5min / 15min) carry full OHLCV; '
  'daily line (1d) carries only close (open/high/low = NULL).';
