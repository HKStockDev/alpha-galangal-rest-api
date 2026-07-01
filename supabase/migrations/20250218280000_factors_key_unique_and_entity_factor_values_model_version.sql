BEGIN;

-- 1) factors.key must be unique (your formulas JSON references factors by key)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'factors_key_unique') THEN
    ALTER TABLE public.factors
    ADD CONSTRAINT factors_key_unique UNIQUE (key);
  END IF;
END $$;

-- 2) Snapshot values: model_version
ALTER TABLE public.entity_factor_values
ADD COLUMN IF NOT EXISTS model_version text;

UPDATE public.entity_factor_values
SET model_version = COALESCE(model_version, 'v1')
WHERE model_version IS NULL;

ALTER TABLE public.entity_factor_values
ALTER COLUMN model_version SET DEFAULT 'v1',
ALTER COLUMN model_version SET NOT NULL;

-- Unique snapshot row per entity+factor+model (will be replaced by period-aware in migration 004)
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_factor_values_entity_factor_model
ON public.entity_factor_values(entity_id, factor_id, model_version);

-- 3) TS values: model_version
ALTER TABLE public.entity_factor_values_ts
ADD COLUMN IF NOT EXISTS model_version text;

UPDATE public.entity_factor_values_ts
SET model_version = COALESCE(model_version, 'v1')
WHERE model_version IS NULL;

ALTER TABLE public.entity_factor_values_ts
ALTER COLUMN model_version SET DEFAULT 'v1',
ALTER COLUMN model_version SET NOT NULL;

COMMIT;
