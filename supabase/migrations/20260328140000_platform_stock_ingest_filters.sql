-- Platform admin: rules for which FMP profiles may be upserted into public.securities.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) securities: fields needed for admin filter evaluation at ingest time
-- ---------------------------------------------------------------------------

ALTER TABLE public.securities
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS avg_volume numeric(20, 4),
  ADD COLUMN IF NOT EXISTS last_price numeric(20, 10),
  ADD COLUMN IF NOT EXISTS avg_dollar_volume numeric(20, 4);

COMMENT ON COLUMN public.securities.country IS
  'Normalized country label from FMP profile at last ingest (for admin filter matching).';
COMMENT ON COLUMN public.securities.avg_volume IS
  'Average share volume from FMP profile (volAvg) at last ingest.';
COMMENT ON COLUMN public.securities.last_price IS
  'Price from FMP profile at last ingest.';
COMMENT ON COLUMN public.securities.avg_dollar_volume IS
  'Approximate avg daily dollar volume (last_price * avg_volume) at last ingest.';

ALTER TABLE public.securities DROP CONSTRAINT IF EXISTS securities_avg_volume_chk;
ALTER TABLE public.securities
  ADD CONSTRAINT securities_avg_volume_chk CHECK (avg_volume IS NULL OR avg_volume >= 0);

ALTER TABLE public.securities DROP CONSTRAINT IF EXISTS securities_last_price_chk;
ALTER TABLE public.securities
  ADD CONSTRAINT securities_last_price_chk CHECK (last_price IS NULL OR last_price >= 0);

ALTER TABLE public.securities DROP CONSTRAINT IF EXISTS securities_avg_dollar_volume_chk;
ALTER TABLE public.securities
  ADD CONSTRAINT securities_avg_dollar_volume_chk CHECK (
    avg_dollar_volume IS NULL OR avg_dollar_volume >= 0
  );

CREATE INDEX IF NOT EXISTS securities_country_idx ON public.securities (country);

-- ---------------------------------------------------------------------------
-- 2) Singleton config row for ingest filters
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_stock_ingest_filters (
  singleton_key text PRIMARY KEY DEFAULT 'default'::text
    CHECK (singleton_key = 'default'),

  exchanges text[] NOT NULL DEFAULT '{}'::text[],
  security_types text[] NOT NULL DEFAULT '{}'::text[],
  countries text[] NOT NULL DEFAULT '{}'::text[],

  min_market_cap_usd numeric(20, 2),
  min_avg_share_volume numeric(20, 4),
  min_price_usd numeric(20, 10),
  min_avg_dollar_volume_usd numeric(20, 2),

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.platform_stock_ingest_filters IS
  'Platform-wide FMP → securities ingest gates. Empty arrays mean no restriction for that dimension; NULL thresholds mean no minimum.';

ALTER TABLE public.platform_stock_ingest_filters DROP CONSTRAINT IF EXISTS platform_stock_ingest_filters_min_cap_chk;
ALTER TABLE public.platform_stock_ingest_filters
  ADD CONSTRAINT platform_stock_ingest_filters_min_cap_chk CHECK (
    min_market_cap_usd IS NULL OR min_market_cap_usd >= 0
  );

ALTER TABLE public.platform_stock_ingest_filters DROP CONSTRAINT IF EXISTS platform_stock_ingest_filters_min_vol_chk;
ALTER TABLE public.platform_stock_ingest_filters
  ADD CONSTRAINT platform_stock_ingest_filters_min_vol_chk CHECK (
    min_avg_share_volume IS NULL OR min_avg_share_volume >= 0
  );

ALTER TABLE public.platform_stock_ingest_filters DROP CONSTRAINT IF EXISTS platform_stock_ingest_filters_min_price_chk;
ALTER TABLE public.platform_stock_ingest_filters
  ADD CONSTRAINT platform_stock_ingest_filters_min_price_chk CHECK (
    min_price_usd IS NULL OR min_price_usd >= 0
  );

ALTER TABLE public.platform_stock_ingest_filters DROP CONSTRAINT IF EXISTS platform_stock_ingest_filters_min_dv_chk;
ALTER TABLE public.platform_stock_ingest_filters
  ADD CONSTRAINT platform_stock_ingest_filters_min_dv_chk CHECK (
    min_avg_dollar_volume_usd IS NULL OR min_avg_dollar_volume_usd >= 0
  );

INSERT INTO public.platform_stock_ingest_filters (singleton_key)
VALUES ('default')
ON CONFLICT (singleton_key) DO NOTHING;

DROP TRIGGER IF EXISTS trg_platform_stock_ingest_filters_set_updated_at ON public.platform_stock_ingest_filters;
CREATE TRIGGER trg_platform_stock_ingest_filters_set_updated_at
  BEFORE UPDATE ON public.platform_stock_ingest_filters
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.platform_stock_ingest_filters ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.platform_stock_ingest_filters TO authenticated;

DROP POLICY IF EXISTS platform_stock_ingest_filters_select_platform_admin ON public.platform_stock_ingest_filters;
CREATE POLICY platform_stock_ingest_filters_select_platform_admin
  ON public.platform_stock_ingest_filters
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS platform_stock_ingest_filters_insert_platform_admin ON public.platform_stock_ingest_filters;
CREATE POLICY platform_stock_ingest_filters_insert_platform_admin
  ON public.platform_stock_ingest_filters
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS platform_stock_ingest_filters_update_platform_admin ON public.platform_stock_ingest_filters;
CREATE POLICY platform_stock_ingest_filters_update_platform_admin
  ON public.platform_stock_ingest_filters
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

COMMIT;
