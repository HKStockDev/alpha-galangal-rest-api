BEGIN;

-- Rename timeframe -> period_key if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='entity_factor_values_ts' AND column_name='timeframe'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='entity_factor_values_ts' AND column_name='period_key'
  ) THEN
    ALTER TABLE public.entity_factor_values_ts RENAME COLUMN timeframe TO period_key;
  END IF;
END $$;

-- Ensure period fields exist
ALTER TABLE public.entity_factor_values_ts
ADD COLUMN IF NOT EXISTS period_key text,
ADD COLUMN IF NOT EXISTS period_months integer;

-- Default period_key
UPDATE public.entity_factor_values_ts
SET period_key = COALESCE(NULLIF(period_key, ''), 'na')
WHERE period_key IS NULL OR period_key = '';

ALTER TABLE public.entity_factor_values_ts
ALTER COLUMN period_key SET DEFAULT 'na',
ALTER COLUMN period_key SET NOT NULL;

-- Add as_of_date so ON CONFLICT works cleanly (expression index would not)
ALTER TABLE public.entity_factor_values_ts
ADD COLUMN IF NOT EXISTS as_of_date date;

UPDATE public.entity_factor_values_ts
SET as_of_date = COALESCE(end_date, period_of_report_date, start_date)::date
WHERE as_of_date IS NULL;

ALTER TABLE public.entity_factor_values_ts
ALTER COLUMN as_of_date SET NOT NULL;

-- Infer period_months from period_key where possible (handles 1y,2y,3y,... and Xm)
UPDATE public.entity_factor_values_ts
SET period_months = CASE
  WHEN period_months IS NOT NULL THEN period_months
  WHEN lower(period_key) ~ '^([0-9]+)y$' THEN (regexp_match(lower(period_key), '^([0-9]+)y$'))[1]::int * 12
  WHEN lower(period_key) ~ '^([0-9]+)yr(s)?$' THEN (regexp_match(lower(period_key), '^([0-9]+)yr'))[1]::int * 12
  WHEN lower(period_key) ~ '^([0-9]+)m$' THEN (regexp_match(lower(period_key), '^([0-9]+)m$'))[1]::int
  ELSE period_months
END
WHERE period_months IS NULL;

-- Unique TS row per as-of date + period + model
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_factor_values_ts_dedupe
ON public.entity_factor_values_ts(entity_id, factor_id, model_version, period_key, as_of_date);

COMMIT;
