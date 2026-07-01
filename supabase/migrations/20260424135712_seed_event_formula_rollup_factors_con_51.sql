BEGIN;

-- ============================================================================
-- ASSUMPTION
-- - periods_supported migration already ran (supports 1,3,...)
-- - market_content + market_content_entities already exist
-- - content_categories migration already ran
-- ============================================================================

-- ============================================================================
-- 1) Seed / upsert factors + formulas (idempotent)
-- ============================================================================
DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'No organization found; skipping factor/formula seed.';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id
  FROM public.signal_categories
  WHERE organization_id = v_org_id
    AND name = 'STRUCTURAL_RISK'
  LIMIT 1;

  IF v_cat_id IS NULL THEN
    SELECT id INTO v_cat_id
    FROM public.signal_categories
    WHERE organization_id = v_org_id
    ORDER BY name
    LIMIT 1;
  END IF;

  INSERT INTO public.factors (
    organization_id,
    key,
    name,
    value_type,
    description,
    data_grain,
    period_supported,
    statement_type
  )
  VALUES
    (
      v_org_id,
      'positive_event_count',
      'Positive Event Count',
      'number',
      'Count of displayable events with polarity=+1 over period window (1m/3m).',
      'snapshot',
      'multi',
      'market_data'
    ),
    (
      v_org_id,
      'negative_event_count',
      'Negative Event Count',
      'number',
      'Count of displayable events with polarity=-1 over period window (1m/3m).',
      'snapshot',
      'multi',
      'market_data'
    ),
    (
      v_org_id,
      'event_pressure',
      'Event Pressure',
      'number',
      'Sum(polarity * severity * materiality_score) over displayable events in period window (1m/3m).',
      'snapshot',
      'multi',
      'market_data'
    ),
    (
      v_org_id,
      'event_pressure_trend',
      'Event Pressure Trend (1m - 3m)',
      'number',
      'event_pressure_1m - event_pressure_3m. Positive=improving, negative=worsening, near zero=stable.',
      'snapshot',
      'none',
      'market_data'
    )
  ON CONFLICT (key) DO UPDATE
  SET
    name = EXCLUDED.name,
    value_type = EXCLUDED.value_type,
    description = EXCLUDED.description,
    data_grain = EXCLUDED.data_grain,
    period_supported = EXCLUDED.period_supported,
    statement_type = EXCLUDED.statement_type;

  INSERT INTO public.formulas (
    organization_id,
    category_id,
    key,
    name,
    output_type,
    definition,
    display_formula,
    description,
    visibility,
    formula_level,
    execution_type,
    version,
    is_active
  )
  VALUES
    (
      v_org_id,
      v_cat_id,
      'positive_event_count',
      'Positive Event Count',
      'number',
      jsonb_build_object(
        'type', 'event_count',
        'filters', jsonb_build_object('polarity', 1, 'should_display', true),
        'window', 'period_key_driven'
      ),
      'COUNT(events WHERE polarity=+1 AND should_display=true AND published_at in last X months)',
      'Positive event count for period window (1m / 3m).',
      'organization',
      'ATOMIC',
      'deterministic',
      1,
      true
    ),
    (
      v_org_id,
      v_cat_id,
      'negative_event_count',
      'Negative Event Count',
      'number',
      jsonb_build_object(
        'type', 'event_count',
        'filters', jsonb_build_object('polarity', -1, 'should_display', true),
        'window', 'period_key_driven'
      ),
      'COUNT(events WHERE polarity=-1 AND should_display=true AND published_at in last X months)',
      'Negative event count for period window (1m / 3m).',
      'organization',
      'ATOMIC',
      'deterministic',
      1,
      true
    ),
    (
      v_org_id,
      v_cat_id,
      'event_pressure',
      'Event Pressure',
      'number',
      jsonb_build_object(
        'type', 'event_pressure',
        'event_score', 'polarity * severity * materiality_score',
        'filters', jsonb_build_object('should_display', true),
        'window', 'period_key_driven'
      ),
      'SUM(polarity * severity * materiality_score) over displayable events in last X months',
      'Event pressure for period window (1m / 3m).',
      'organization',
      'ATOMIC',
      'deterministic',
      1,
      true
    ),
    (
      v_org_id,
      v_cat_id,
      'event_pressure_trend',
      'Event Pressure Trend (1m - 3m)',
      'number',
      jsonb_build_object(
        'type', 'derived',
        'operation', 'subtract',
        'left', jsonb_build_object('factor', 'event_pressure', 'period_key', '1m'),
        'right', jsonb_build_object('factor', 'event_pressure', 'period_key', '3m')
      ),
      'event_pressure(1m) - event_pressure(3m)',
      'Positive=improving catalyst environment; negative=worsening; near zero=stable.',
      'organization',
      'DOMAIN_COMPOSITE',
      'deterministic',
      1,
      true
    )
  ON CONFLICT (key) DO UPDATE
  SET
    name = EXCLUDED.name,
    output_type = EXCLUDED.output_type,
    definition = EXCLUDED.definition,
    display_formula = EXCLUDED.display_formula,
    description = EXCLUDED.description,
    category_id = EXCLUDED.category_id,
    visibility = EXCLUDED.visibility,
    formula_level = EXCLUDED.formula_level,
    execution_type = EXCLUDED.execution_type,
    is_active = EXCLUDED.is_active;
END $$;

-- ============================================================================
-- 2) Recompute and upsert entity_factor_values for 1m/3m (+ trend)
--    Formula basis:
--      positive_event_count = count(polarity=+1, should_display=true, published_at>=now-X)
--      negative_event_count = count(polarity=-1, should_display=true, published_at>=now-X)
--      event_pressure       = sum(polarity*severity*materiality_score, should_display=true, published_at>=now-X)
--      trend                = event_pressure_1m - event_pressure_3m
-- ============================================================================
WITH target_factors AS (
  SELECT key, id AS factor_id
  FROM public.factors
  WHERE key IN (
    'positive_event_count',
    'negative_event_count',
    'event_pressure',
    'event_pressure_trend'
  )
),
entity_universe AS (
  SELECT DISTINCT mce.entity_id
  FROM public.market_content_entities mce
  UNION
  SELECT DISTINCT efv.entity_id
  FROM public.entity_factor_values efv
  JOIN target_factors tf ON tf.factor_id = efv.factor_id
),
periods AS (
  SELECT * FROM (VALUES ('1m'::text, 1), ('3m'::text, 3)) v(period_key, period_months)
),
agg AS (
  SELECT
    eu.entity_id,
    p.period_key,
    p.period_months,

    COUNT(*) FILTER (
      WHERE mce.should_display = true
        AND mce.polarity = 1
        AND mc.published_at >= now() - make_interval(months => p.period_months)
    )::double precision AS positive_event_count,

    COUNT(*) FILTER (
      WHERE mce.should_display = true
        AND mce.polarity = -1
        AND mc.published_at >= now() - make_interval(months => p.period_months)
    )::double precision AS negative_event_count,

    COALESCE(
      SUM(
        CASE
          WHEN mce.should_display = true
           AND mc.published_at >= now() - make_interval(months => p.period_months)
          THEN
            COALESCE(mce.polarity, 0)::double precision
            * COALESCE(mce.severity, 1)::double precision
            * COALESCE(mce.materiality_score, 1)::double precision
          ELSE 0::double precision
        END
      ),
      0::double precision
    ) AS event_pressure
  FROM entity_universe eu
  CROSS JOIN periods p
  LEFT JOIN public.market_content_entities mce
    ON mce.entity_id = eu.entity_id
  LEFT JOIN public.market_content mc
    ON mc.id = mce.market_content_id
  GROUP BY eu.entity_id, p.period_key, p.period_months
),
metric_rows AS (
  SELECT entity_id, 'positive_event_count'::text AS factor_key, period_key, period_months, positive_event_count AS value_num
  FROM agg
  UNION ALL
  SELECT entity_id, 'negative_event_count'::text AS factor_key, period_key, period_months, negative_event_count AS value_num
  FROM agg
  UNION ALL
  SELECT entity_id, 'event_pressure'::text AS factor_key, period_key, period_months, event_pressure AS value_num
  FROM agg
),
trend_rows AS (
  SELECT
    a1.entity_id,
    'event_pressure_trend'::text AS factor_key,
    'na'::text AS period_key,
    NULL::integer AS period_months,
    (COALESCE(a1.event_pressure, 0) - COALESCE(a3.event_pressure, 0))::double precision AS value_num
  FROM (SELECT * FROM agg WHERE period_key = '1m') a1
  JOIN (SELECT * FROM agg WHERE period_key = '3m') a3
    ON a3.entity_id = a1.entity_id
),
all_rows AS (
  SELECT * FROM metric_rows
  UNION ALL
  SELECT * FROM trend_rows
)
INSERT INTO public.entity_factor_values (
  entity_id,
  factor_id,
  model_version,
  period_key,
  period_months,
  value_num,
  source,
  ingested_at,
  updated_at
)
SELECT
  r.entity_id,
  tf.factor_id,
  'v1'::text AS model_version,
  r.period_key,
  r.period_months,
  r.value_num,
  'event_formula_rollup'::text AS source,
  now() AS ingested_at,
  now() AS updated_at
FROM all_rows r
JOIN target_factors tf
  ON tf.key = r.factor_key
ON CONFLICT (entity_id, factor_id, model_version, period_key) DO UPDATE
SET
  value_num = EXCLUDED.value_num,
  period_months = EXCLUDED.period_months,
  source = EXCLUDED.source,
  ingested_at = EXCLUDED.ingested_at,
  updated_at = EXCLUDED.updated_at;

-- ============================================================================
-- 3) Upsert entity_factor_values_ts snapshot rows for same outputs
--    (as_of_date = current_date)
-- ============================================================================
WITH target_factors AS (
  SELECT key, id AS factor_id
  FROM public.factors
  WHERE key IN (
    'positive_event_count',
    'negative_event_count',
    'event_pressure',
    'event_pressure_trend'
  )
),
rows_for_ts AS (
  SELECT
    efv.entity_id,
    tf.key AS factor_key,
    efv.factor_id,
    efv.value_num,
    efv.period_key,
    efv.period_months
  FROM public.entity_factor_values efv
  JOIN target_factors tf
    ON tf.factor_id = efv.factor_id
  WHERE efv.model_version = 'v1'
    AND (
      (tf.key IN ('positive_event_count', 'negative_event_count', 'event_pressure') AND efv.period_key IN ('1m', '3m'))
      OR (tf.key = 'event_pressure_trend' AND efv.period_key = 'na')
    )
)
INSERT INTO public.entity_factor_values_ts (
  entity_id,
  factor_id,
  value_num,
  value_text,
  unit,
  currency,
  period_key,
  period_months,
  start_date,
  end_date,
  period_of_report_date,
  model_version,
  as_of_date,
  source,
  ingested_at
)
SELECT
  r.entity_id,
  r.factor_id,
  r.value_num,
  NULL::text AS value_text,
  NULL::text AS unit,
  NULL::text AS currency,
  r.period_key,
  r.period_months,
  CASE
    WHEN r.period_key = '1m' THEN (current_date - interval '1 month')::date
    WHEN r.period_key = '3m' THEN (current_date - interval '3 months')::date
    ELSE (current_date - interval '3 months')::date
  END AS start_date,
  current_date AS end_date,
  current_date AS period_of_report_date,
  'v1'::text AS model_version,
  current_date AS as_of_date,
  'event_formula_rollup'::text AS source,
  now() AS ingested_at
FROM rows_for_ts r
ON CONFLICT (entity_id, factor_id, model_version, period_key, as_of_date) DO UPDATE
SET
  value_num = EXCLUDED.value_num,
  period_months = EXCLUDED.period_months,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  period_of_report_date = EXCLUDED.period_of_report_date,
  source = EXCLUDED.source,
  ingested_at = EXCLUDED.ingested_at;

COMMIT;
