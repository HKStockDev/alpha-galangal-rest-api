BEGIN;

ALTER TABLE public.factors DROP CONSTRAINT IF EXISTS chk_factors_period_supported;
ALTER TABLE public.factors ADD CONSTRAINT chk_factors_period_supported
  CHECK (period_supported IN ('quarterly', 'annual', 'both', 'none', '6,12,24', 'multi'));

------------------------------------------------------------
-- A) Snapshot table needs period dimension after normalization
------------------------------------------------------------
ALTER TABLE public.entity_factor_values
ADD COLUMN IF NOT EXISTS period_key text,
ADD COLUMN IF NOT EXISTS period_months integer;

UPDATE public.entity_factor_values
SET period_key = COALESCE(NULLIF(period_key, ''), 'na')
WHERE period_key IS NULL OR period_key = '';

ALTER TABLE public.entity_factor_values
ALTER COLUMN period_key SET DEFAULT 'na',
ALTER COLUMN period_key SET NOT NULL;

ALTER TABLE public.entity_factor_values DROP CONSTRAINT IF EXISTS entity_factor_values_pkey;
DROP INDEX IF EXISTS public.uq_entity_factor_values_entity_factor;
DROP INDEX IF EXISTS public.ux_entity_factor_values_entity_factor_model;

ALTER TABLE public.entity_factor_values
  ADD PRIMARY KEY (entity_id, factor_id, model_version, period_key);

------------------------------------------------------------
-- B) Build mapping from existing factors (_<N>_yr or _<N>_year)
-- C) Insert normalized factor definitions
------------------------------------------------------------
WITH candidate AS (
  SELECT
    f.id AS old_factor_id,
    f.key AS old_key,
    f.value_type,
    f.data_grain,
    f.statement_type,
    COALESCE(
      (regexp_match(f.key, '_(\d+)_yr'))[1]::int,
      (regexp_match(f.key, '_(\d+)_year'))[1]::int
    ) AS years
  FROM public.factors f
  WHERE f.key ~ '_\d+_yr' OR f.key ~ '_\d+_year'
),
mapping AS (
  SELECT
    old_factor_id,
    old_key,
    years,
    (years * 12) AS period_months,
    (years::text || 'y') AS period_key,
    regexp_replace(
      regexp_replace(old_key, '_\d+_yr_', '_', 'g'),
      '_\d+_year_', '_', 'g'
    ) AS new_key_step1,
    value_type,
    data_grain,
    statement_type
  FROM candidate
),
mapping2 AS (
  SELECT
    old_factor_id,
    old_key,
    years,
    period_months,
    period_key,
    regexp_replace(
      regexp_replace(new_key_step1, '_\d+_yr$', '', 'g'),
      '_\d+_year$', '', 'g'
    ) AS new_key,
    value_type,
    data_grain,
    statement_type
  FROM mapping
),
rep AS (
  SELECT new_key, (array_agg(old_factor_id ORDER BY old_factor_id))[1] AS sample_old_factor_id
  FROM mapping2
  GROUP BY new_key
)
INSERT INTO public.factors (
  id, key, name, value_type, description, created_at, data_grain, period_supported, statement_type
)
SELECT
  gen_random_uuid(),
  r.new_key,
  INITCAP(REPLACE(r.new_key, '_', ' ')),
  f.value_type,
  'Normalized factor. Period is stored on values rows (period_key/period_months).',
  now(),
  f.data_grain,
  'multi',
  f.statement_type
FROM rep r
JOIN public.factors f ON f.id = r.sample_old_factor_id
ON CONFLICT (key) DO NOTHING;

------------------------------------------------------------
-- D) Copy SNAPSHOT values: old factor -> new factor + period fields
------------------------------------------------------------
WITH candidate AS (
  SELECT f.id AS old_factor_id, f.key AS old_key, f.value_type, f.data_grain, f.statement_type,
    COALESCE((regexp_match(f.key, '_(\d+)_yr'))[1]::int, (regexp_match(f.key, '_(\d+)_year'))[1]::int) AS years
  FROM public.factors f
  WHERE f.key ~ '_\d+_yr' OR f.key ~ '_\d+_year'
),
mapping AS (
  SELECT old_factor_id, old_key, years, (years * 12) AS period_months, (years::text || 'y') AS period_key,
    regexp_replace(regexp_replace(old_key, '_\d+_yr_', '_', 'g'), '_\d+_year_', '_', 'g') AS new_key_step1,
    value_type, data_grain, statement_type
  FROM candidate
),
mapping2 AS (
  SELECT old_factor_id, old_key, years, period_months, period_key,
    regexp_replace(regexp_replace(new_key_step1, '_\d+_yr$', '', 'g'), '_\d+_year$', '', 'g') AS new_key,
    value_type, data_grain, statement_type
  FROM mapping
)
INSERT INTO public.entity_factor_values (
  entity_id, factor_id, value_num, value_text, updated_at, source, ingested_at,
  model_version, period_key, period_months
)
SELECT
  efv.entity_id,
  newf.id AS factor_id,
  efv.value_num,
  efv.value_text,
  efv.updated_at,
  efv.source,
  efv.ingested_at,
  efv.model_version,
  m.period_key,
  m.period_months
FROM public.entity_factor_values efv
JOIN public.factors oldf ON oldf.id = efv.factor_id
JOIN mapping2 m ON m.old_key = oldf.key
JOIN public.factors newf ON newf.key = m.new_key
ON CONFLICT (entity_id, factor_id, model_version, period_key) DO UPDATE
SET
  value_num = EXCLUDED.value_num,
  value_text = EXCLUDED.value_text,
  updated_at = EXCLUDED.updated_at,
  source = EXCLUDED.source,
  ingested_at = EXCLUDED.ingested_at,
  period_months = EXCLUDED.period_months;

------------------------------------------------------------
-- E) Copy TS values: old factor -> new factor + period fields
------------------------------------------------------------
WITH candidate AS (
  SELECT f.id AS old_factor_id, f.key AS old_key,
    COALESCE((regexp_match(f.key, '_(\d+)_yr'))[1]::int, (regexp_match(f.key, '_(\d+)_year'))[1]::int) AS years
  FROM public.factors f
  WHERE f.key ~ '_\d+_yr' OR f.key ~ '_\d+_year'
),
mapping AS (
  SELECT old_factor_id, old_key, (years * 12) AS period_months, (years::text || 'y') AS period_key,
    regexp_replace(regexp_replace(old_key, '_\d+_yr_', '_', 'g'), '_\d+_year_', '_', 'g') AS new_key_step1
  FROM candidate
),
mapping2 AS (
  SELECT old_key, period_key, period_months,
    regexp_replace(regexp_replace(new_key_step1, '_\d+_yr$', '', 'g'), '_\d+_year$', '', 'g') AS new_key
  FROM mapping
)
INSERT INTO public.entity_factor_values_ts (
  id, entity_id, factor_id,
  value_num, value_text, unit, currency,
  period_key, period_months,
  fiscal_year, fiscal_period,
  start_date, end_date, period_of_report_date,
  model_version,
  as_of_date
)
SELECT
  gen_random_uuid(),
  ts.entity_id,
  newf.id AS factor_id,
  ts.value_num,
  ts.value_text,
  ts.unit,
  ts.currency,
  m.period_key,
  m.period_months,
  ts.fiscal_year,
  ts.fiscal_period,
  ts.start_date,
  ts.end_date,
  ts.period_of_report_date,
  ts.model_version,
  COALESCE(ts.end_date, ts.period_of_report_date, ts.start_date)::date AS as_of_date
FROM public.entity_factor_values_ts ts
JOIN public.factors oldf ON oldf.id = ts.factor_id
JOIN mapping2 m ON m.old_key = oldf.key
JOIN public.factors newf ON newf.key = m.new_key
ON CONFLICT (entity_id, factor_id, model_version, period_key, as_of_date) DO UPDATE
SET
  value_num = EXCLUDED.value_num,
  value_text = EXCLUDED.value_text,
  unit = EXCLUDED.unit,
  currency = EXCLUDED.currency,
  fiscal_year = EXCLUDED.fiscal_year,
  fiscal_period = EXCLUDED.fiscal_period,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  period_of_report_date = EXCLUDED.period_of_report_date,
  period_months = EXCLUDED.period_months;

------------------------------------------------------------
-- F) Update formulas.definition JSONB: old_key -> new_key + period_key/period_months
------------------------------------------------------------
WITH candidate AS (
  SELECT f.key AS old_key,
    COALESCE((regexp_match(f.key, '_(\d+)_yr'))[1]::int, (regexp_match(f.key, '_(\d+)_year'))[1]::int) AS years
  FROM public.factors f
  WHERE f.key ~ '_\d+_yr' OR f.key ~ '_\d+_year'
),
mapping AS (
  SELECT old_key, (years * 12) AS period_months, (years::text || 'y') AS period_key,
    regexp_replace(regexp_replace(old_key, '_\d+_yr_', '_', 'g'), '_\d+_year_', '_', 'g') AS new_key_step1
  FROM candidate
),
mapping2 AS (
  SELECT old_key, period_key, period_months,
    regexp_replace(regexp_replace(new_key_step1, '_\d+_yr$', '', 'g'), '_\d+_year$', '', 'g') AS new_key
  FROM mapping
)
UPDATE public.formulas fo
SET definition =
  jsonb_set(
    fo.definition,
    '{terms}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN mp.old_key IS NOT NULL THEN
            (term - 'f')
              || jsonb_build_object(
                   'f', mp.new_key,
                   'period_key', mp.period_key,
                   'period_months', mp.period_months
                 )
          ELSE term
        END
        ORDER BY ord
      )
      FROM jsonb_array_elements(fo.definition->'terms') WITH ORDINALITY AS t(term, ord)
      LEFT JOIN mapping2 mp ON (t.term->>'f') = mp.old_key
    ),
    true
  )
WHERE fo.definition ? 'terms'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(fo.definition->'terms') term
    JOIN mapping2 mp ON (term->>'f') = mp.old_key
  );

COMMIT;
