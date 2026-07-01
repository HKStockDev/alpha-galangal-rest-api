BEGIN;

------------------------------------------------------------
-- 0) Ensure required columns exist on value tables
------------------------------------------------------------

ALTER TABLE public.entity_factor_values
ADD COLUMN IF NOT EXISTS model_version text,
ADD COLUMN IF NOT EXISTS period_key text,
ADD COLUMN IF NOT EXISTS period_months integer;

UPDATE public.entity_factor_values
SET model_version = COALESCE(model_version, 'v1')
WHERE model_version IS NULL;

UPDATE public.entity_factor_values
SET period_key = COALESCE(NULLIF(period_key, ''), 'na')
WHERE period_key IS NULL OR period_key = '';

ALTER TABLE public.entity_factor_values
ALTER COLUMN model_version SET DEFAULT 'v1',
ALTER COLUMN model_version SET NOT NULL,
ALTER COLUMN period_key SET DEFAULT 'na',
ALTER COLUMN period_key SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='ux_entity_factor_values_entity_factor_model'
  ) THEN
    EXECUTE 'DROP INDEX public.ux_entity_factor_values_entity_factor_model';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_factor_values_entity_factor_model_period
ON public.entity_factor_values(entity_id, factor_id, model_version, period_key);

-- TS: add period_key/period_months/model_version/as_of_date if missing
ALTER TABLE public.entity_factor_values_ts DROP CONSTRAINT IF EXISTS chk_evts_timeframe;

ALTER TABLE public.entity_factor_values_ts
ADD COLUMN IF NOT EXISTS model_version text,
ADD COLUMN IF NOT EXISTS period_key text,
ADD COLUMN IF NOT EXISTS period_months integer,
ADD COLUMN IF NOT EXISTS as_of_date date;

UPDATE public.entity_factor_values_ts
SET model_version = COALESCE(model_version, 'v1')
WHERE model_version IS NULL;

UPDATE public.entity_factor_values_ts
SET period_key = COALESCE(NULLIF(period_key, ''), 'na')
WHERE period_key IS NULL OR period_key = '';

ALTER TABLE public.entity_factor_values_ts
ALTER COLUMN model_version SET DEFAULT 'v1',
ALTER COLUMN model_version SET NOT NULL,
ALTER COLUMN period_key SET DEFAULT 'na',
ALTER COLUMN period_key SET NOT NULL;

UPDATE public.entity_factor_values_ts
SET as_of_date = COALESCE(as_of_date, end_date, period_of_report_date, start_date)::date
WHERE as_of_date IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_factor_values_ts_dedupe
ON public.entity_factor_values_ts(entity_id, factor_id, model_version, period_key, as_of_date);

------------------------------------------------------------
-- 1) Backfill metrics from hedge_funds into entity_factor_values (+ TS)
------------------------------------------------------------

WITH src AS (
  SELECT
    hf.entity_id,
    COALESCE(hf.date_filed::date, now()::date) AS as_of_date,
    v.factor_key,
    v.value_num,
    v.period_key,
    v.period_months
  FROM public.hedge_funds hf
  CROSS JOIN LATERAL (
    VALUES
      ('whale_score_equal_wt', hf.whale_score_1_yr_equal_wt::double precision, '1y', 12),
      ('whale_score_mgr_wt',   hf.whale_score_1_yr_mgr_wt::double precision,   '1y', 12),
      ('whale_score_equal_wt', hf.whale_score_qtr_equal_wt::double precision,  '1q', 3),

      ('holdings_count',       hf.holdings::double precision,                 'na', NULL),
      ('aum_13f',              hf.f_13f_aum::double precision,                'na', NULL),
      ('turnover',             hf.turnover::double precision,                'na', NULL),
      ('pct_in_top_10',        hf.pct_in_top_10::double precision,            'na', NULL),
      ('avg_time_in_top_10',   hf.avg_time_in_top_10::double precision,       'na', NULL),
      ('avg_time_held',        hf.avg_time_held::double precision,            'na', NULL),

      ('perf_equal',           hf.perf_equal_1_year::double precision,        '1y', 12),
      ('perf_equal',           hf.perf_equal_5_year::double precision,        '5y', 60),
      ('perf_mgr_wt',          hf.perf_mgr_wt_1_year::double precision,       '1y', 12),
      ('perf_mgr_wt',          hf.perf_mgr_wt_5_year::double precision,       '5y', 60),

      ('perf_annualized_equal', hf.perf_3_yr_annualized::double precision,    '3y', 36),
      ('perf_annualized_equal', hf.perf_5_yr_annualized::double precision,    '5y', 60),
      ('perf_annualized_equal', hf.perf_7_yr_annualized::double precision,    '7y', 84),
      ('perf_annualized_equal', hf.perf_10_yr_annualized::double precision,   '10y', 120),

      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_3_yr_annualized::double precision, '3y', 36),
      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_5_yr_annualized::double precision, '5y', 60),
      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_7_yr_annualized::double precision, '7y', 84),
      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_10_yr_annualized::double precision,'10y',120),

      ('sortino_equal_weight', hf.sortino_3_yr_equal_weight::double precision,'3y', 36),
      ('stddev',               hf.stddev_3_yr::double precision,              '3y', 36),
      ('beta',                 hf.beta_5_yr::double precision,                '5y', 60),
      ('alpha',                hf.alpha_3_yr::double precision,               '3y', 36),

      ('etf_aum',              hf.etf_aum::double precision,                   'na', NULL),
      ('etf_aum_pct',          hf.etf_aum_pct::double precision,               'na', NULL),
      ('option_aum',           hf.option_aum::double precision,                'na', NULL),
      ('option_aum_pct',       hf.option_aum_pct::double precision,            'na', NULL),
      ('call_aum',             hf.call_aum::double precision,                  'na', NULL),
      ('call_aum_pct',         hf.call_aum_pct::double precision,            'na', NULL),
      ('put_aum',              hf.put_aum::double precision,                  'na', NULL),
      ('put_aum_pct',          hf.put_aum_pct::double precision,               'na', NULL),

      ('prior_mv',             hf.prior_mv::double precision,                  'na', NULL),
      ('change_in_mv',         hf.change_in_mv::double precision,              'na', NULL),
      ('shares_traded',        hf.shares_traded::double precision,             'na', NULL),
      ('put_count',            hf.put_count::double precision,                  'na', NULL),
      ('call_count',           hf.call_count::double precision,                 'na', NULL),
      ('previous_13f_aum',     hf.previous_13f_aum::double precision,          'na', NULL)

  ) v(factor_key, value_num, period_key, period_months)
  WHERE hf.entity_id IS NOT NULL
    AND v.value_num IS NOT NULL
),

ins_factors AS (
  INSERT INTO public.factors (id, key, name, value_type, description, created_at, data_grain, period_supported, statement_type)
  SELECT
    gen_random_uuid(),
    s.factor_key,
    INITCAP(REPLACE(s.factor_key, '_', ' ')),
    'number',
    'Imported from WhaleWisdom hedge fund CSV (migrated from hedge_funds columns).',
    now(),
    'snapshot',
    'multi',
    'market_data'
  FROM (SELECT DISTINCT factor_key FROM src) s
  ON CONFLICT (key) DO NOTHING
  RETURNING id, key
),

resolved AS (
  SELECT
    s.*,
    f.id AS factor_id
  FROM src s
  JOIN public.factors f ON f.key = s.factor_key
)

INSERT INTO public.entity_factor_values (
  entity_id, factor_id, value_num, value_text, updated_at, source, ingested_at,
  model_version, period_key, period_months
)
SELECT
  r.entity_id,
  r.factor_id,
  r.value_num,
  NULL,
  now(),
  'whalewisdom_csv',
  now(),
  'v1',
  r.period_key,
  r.period_months
FROM resolved r
ON CONFLICT (entity_id, factor_id, model_version, period_key) DO UPDATE
SET
  value_num = EXCLUDED.value_num,
  updated_at = EXCLUDED.updated_at,
  source = EXCLUDED.source,
  ingested_at = EXCLUDED.ingested_at,
  period_months = EXCLUDED.period_months;

WITH src_ts AS (
  SELECT
    hf.entity_id,
    COALESCE(hf.date_filed::date, now()::date) AS as_of_date,
    v.factor_key,
    v.value_num,
    v.period_key,
    v.period_months
  FROM public.hedge_funds hf
  CROSS JOIN LATERAL (
    VALUES
      ('whale_score_equal_wt', hf.whale_score_1_yr_equal_wt::double precision, '1y', 12),
      ('whale_score_mgr_wt',   hf.whale_score_1_yr_mgr_wt::double precision,   '1y', 12),
      ('whale_score_equal_wt', hf.whale_score_qtr_equal_wt::double precision,  '1q', 3),
      ('holdings_count',       hf.holdings::double precision,                 'na', NULL),
      ('aum_13f',              hf.f_13f_aum::double precision,                'na', NULL),
      ('turnover',             hf.turnover::double precision,                'na', NULL),
      ('pct_in_top_10',        hf.pct_in_top_10::double precision,            'na', NULL),
      ('avg_time_in_top_10',   hf.avg_time_in_top_10::double precision,       'na', NULL),
      ('avg_time_held',        hf.avg_time_held::double precision,            'na', NULL),
      ('perf_equal',           hf.perf_equal_1_year::double precision,        '1y', 12),
      ('perf_equal',           hf.perf_equal_5_year::double precision,        '5y', 60),
      ('perf_mgr_wt',          hf.perf_mgr_wt_1_year::double precision,       '1y', 12),
      ('perf_mgr_wt',          hf.perf_mgr_wt_5_year::double precision,       '5y', 60),
      ('perf_annualized_equal', hf.perf_3_yr_annualized::double precision,    '3y', 36),
      ('perf_annualized_equal', hf.perf_5_yr_annualized::double precision,    '5y', 60),
      ('perf_annualized_equal', hf.perf_7_yr_annualized::double precision,    '7y', 84),
      ('perf_annualized_equal', hf.perf_10_yr_annualized::double precision,   '10y', 120),
      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_3_yr_annualized::double precision, '3y', 36),
      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_5_yr_annualized::double precision, '5y', 60),
      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_7_yr_annualized::double precision, '7y', 84),
      ('perf_annualized_mgr_wt', hf.perf_mgr_wt_10_yr_annualized::double precision,'10y',120),
      ('sortino_equal_weight', hf.sortino_3_yr_equal_weight::double precision,'3y', 36),
      ('stddev',               hf.stddev_3_yr::double precision,              '3y', 36),
      ('beta',                 hf.beta_5_yr::double precision,                '5y', 60),
      ('alpha',                hf.alpha_3_yr::double precision,               '3y', 36),
      ('etf_aum',              hf.etf_aum::double precision,                   'na', NULL),
      ('etf_aum_pct',          hf.etf_aum_pct::double precision,               'na', NULL),
      ('option_aum',           hf.option_aum::double precision,                'na', NULL),
      ('option_aum_pct',       hf.option_aum_pct::double precision,            'na', NULL),
      ('call_aum',             hf.call_aum::double precision,                  'na', NULL),
      ('call_aum_pct',         hf.call_aum_pct::double precision,            'na', NULL),
      ('put_aum',              hf.put_aum::double precision,                  'na', NULL),
      ('put_aum_pct',          hf.put_aum_pct::double precision,               'na', NULL),
      ('prior_mv',             hf.prior_mv::double precision,                  'na', NULL),
      ('change_in_mv',         hf.change_in_mv::double precision,              'na', NULL),
      ('shares_traded',        hf.shares_traded::double precision,             'na', NULL),
      ('put_count',            hf.put_count::double precision,                  'na', NULL),
      ('call_count',           hf.call_count::double precision,                 'na', NULL),
      ('previous_13f_aum',     hf.previous_13f_aum::double precision,          'na', NULL)
  ) v(factor_key, value_num, period_key, period_months)
  WHERE hf.entity_id IS NOT NULL AND v.value_num IS NOT NULL
),
resolved_ts AS (
  SELECT s.*, f.id AS factor_id
  FROM src_ts s
  JOIN public.factors f ON f.key = s.factor_key
)
INSERT INTO public.entity_factor_values_ts (
  id, entity_id, factor_id, value_num, value_text, unit, currency,
  period_key, period_months, fiscal_year, fiscal_period,
  start_date, end_date, period_of_report_date,
  model_version, as_of_date, source, ingested_at
)
SELECT
  gen_random_uuid(),
  r.entity_id,
  r.factor_id,
  r.value_num,
  NULL,
  NULL,
  NULL,
  r.period_key,
  r.period_months,
  NULL,
  NULL,
  r.as_of_date,
  r.as_of_date,
  r.as_of_date,
  'v1',
  r.as_of_date,
  'whalewisdom_csv',
  now()
FROM resolved_ts r
ON CONFLICT (entity_id, factor_id, model_version, period_key, as_of_date) DO UPDATE
SET
  value_num = EXCLUDED.value_num,
  period_months = EXCLUDED.period_months;

------------------------------------------------------------
-- 2) Drop metric columns from hedge_funds (keep identity fields only)
------------------------------------------------------------

DROP VIEW IF EXISTS public.hedge_funds_list;

ALTER TABLE public.hedge_funds
  DROP COLUMN IF EXISTS whale_score_1_yr_equal_wt,
  DROP COLUMN IF EXISTS whale_score_1_yr_mgr_wt,
  DROP COLUMN IF EXISTS whale_score_qtr_equal_wt,

  DROP COLUMN IF EXISTS holdings,
  DROP COLUMN IF EXISTS f_13f_aum,
  DROP COLUMN IF EXISTS turnover,
  DROP COLUMN IF EXISTS pct_in_top_10,

  DROP COLUMN IF EXISTS perf_equal_qoq,
  DROP COLUMN IF EXISTS perf_equal_all,
  DROP COLUMN IF EXISTS perf_mgr_qoq,
  DROP COLUMN IF EXISTS perf_mgr_all,

  DROP COLUMN IF EXISTS perf_equal_1_year,
  DROP COLUMN IF EXISTS perf_equal_5_year,
  DROP COLUMN IF EXISTS perf_mgr_wt_1_year,
  DROP COLUMN IF EXISTS perf_mgr_wt_5_year,

  DROP COLUMN IF EXISTS perf_3_yr_annualized,
  DROP COLUMN IF EXISTS perf_5_yr_annualized,
  DROP COLUMN IF EXISTS perf_7_yr_annualized,
  DROP COLUMN IF EXISTS perf_10_yr_annualized,

  DROP COLUMN IF EXISTS perf_mgr_wt_3_yr_annualized,
  DROP COLUMN IF EXISTS perf_mgr_wt_5_yr_annualized,
  DROP COLUMN IF EXISTS perf_mgr_wt_7_yr_annualized,
  DROP COLUMN IF EXISTS perf_mgr_wt_10_yr_annualized,

  DROP COLUMN IF EXISTS avg_time_in_top_10,
  DROP COLUMN IF EXISTS avg_time_held,

  DROP COLUMN IF EXISTS change_in_mv,
  DROP COLUMN IF EXISTS put_count,
  DROP COLUMN IF EXISTS call_count,
  DROP COLUMN IF EXISTS prior_mv,
  DROP COLUMN IF EXISTS shares_traded,

  DROP COLUMN IF EXISTS sortino_3_yr_equal_weight,
  DROP COLUMN IF EXISTS stddev_3_yr,
  DROP COLUMN IF EXISTS beta_5_yr,
  DROP COLUMN IF EXISTS alpha_3_yr,

  DROP COLUMN IF EXISTS etf_aum,
  DROP COLUMN IF EXISTS etf_aum_pct,
  DROP COLUMN IF EXISTS option_aum,
  DROP COLUMN IF EXISTS option_aum_pct,
  DROP COLUMN IF EXISTS call_aum,
  DROP COLUMN IF EXISTS call_aum_pct,
  DROP COLUMN IF EXISTS put_aum,
  DROP COLUMN IF EXISTS put_aum_pct,

  DROP COLUMN IF EXISTS previous_13f_aum;

CREATE VIEW public.hedge_funds_list AS
SELECT
  h.filer_id,
  h.filer,
  h.entity_id,
  esc.score AS hedge_fund_quality_score
FROM public.hedge_funds h
LEFT JOIN public.entity_scores_current esc ON h.entity_id = esc.entity_id
LEFT JOIN public.formulas f ON esc.formula_id = f.id AND f.key = 'hedge_fund_quality_score';

ALTER VIEW public.hedge_funds_list SET (security_invoker = on);

COMMIT;
