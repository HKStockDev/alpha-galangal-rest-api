BEGIN;

-- Ensure canonical factor keys exist for normalized hedge-fund metrics.
INSERT INTO public.factors (key, name, value_type, factor_origin, factor_visibility_mode)
SELECT v.key, v.name, v.value_type, 'system', 'public'
FROM (
  VALUES
    ('perf_annualized', 'Perf Annualized', 'number'),
    ('perf_mgr_wt_annualized', 'Perf Mgr Wt Annualized', 'number'),
    ('alpha', 'Alpha', 'number'),
    ('sortino_equal_weight', 'Sortino Equal Weight', 'number'),
    ('stddev', 'Stddev', 'number'),
    ('beta', 'Beta', 'number')
) AS v(key, name, value_type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.factors f WHERE f.key = v.key AND f.factor_origin = 'system'
);

-- Copy legacy flat-key EFV rows (period_key = 'na') into canonical period-keyed rows
-- for hedge-fund entities, only when the canonical row does not already exist.
INSERT INTO public.entity_factor_values (
  entity_id,
  factor_id,
  value_num,
  value_text,
  updated_at,
  source,
  ingested_at,
  model_version,
  period_key,
  period_months
)
SELECT
  src.entity_id,
  f_new.id,
  src.value_num,
  src.value_text,
  src.updated_at,
  COALESCE(src.source, 'legacy_factor_key_migration'),
  COALESCE(src.ingested_at, now()),
  src.model_version,
  map.canonical_period_key,
  map.period_months
FROM public.entity_factor_values src
JOIN public.factors f_old ON f_old.id = src.factor_id
JOIN public.entities e ON e.id = src.entity_id AND e.entity_type = 'hedge_fund'
JOIN (
  VALUES
    ('perf_3_yr_annualized', 'perf_annualized', '3y', 36),
    ('perf_5_yr_annualized', 'perf_annualized', '5y', 60),
    ('perf_7_yr_annualized', 'perf_annualized', '7y', 84),
    ('perf_10_yr_annualized', 'perf_annualized', '10y', 120),
    ('perf_mgr_wt_5_yr_annualized', 'perf_mgr_wt_annualized', '5y', 60),
    ('alpha_3_yr', 'alpha', '3y', 36),
    ('sortino_3_yr_equal_weight', 'sortino_equal_weight', '3y', 36),
    ('stddev_3_yr', 'stddev', '3y', 36),
    ('beta_5_yr', 'beta', '5y', 60)
) AS map(legacy_key, canonical_key, canonical_period_key, period_months)
  ON f_old.key = map.legacy_key
JOIN public.factors f_new ON f_new.key = map.canonical_key
WHERE src.period_key = 'na'
  AND src.model_version = 'v1'
  AND NOT EXISTS (
    SELECT 1
    FROM public.entity_factor_values existing
    WHERE existing.entity_id = src.entity_id
      AND existing.factor_id = f_new.id
      AND existing.model_version = src.model_version
      AND existing.period_key = map.canonical_period_key
  );

COMMIT;
