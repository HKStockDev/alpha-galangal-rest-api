BEGIN;

WITH periods AS (
  SELECT '6m' AS period_key, 6 AS period_months
  UNION ALL SELECT '12m', 12
  UNION ALL SELECT '24m', 24
),
sector_entities AS (
  SELECT e.id AS entity_id
  FROM entities e
  WHERE e.entity_type = 'sector' AND e.taxonomy_node_id IS NOT NULL
),
industry_entities AS (
  SELECT e.id AS entity_id
  FROM entities e
  WHERE e.entity_type = 'industry' AND e.taxonomy_node_id IS NOT NULL
),
sub_industry_entities AS (
  SELECT e.id AS entity_id
  FROM entities e
  WHERE e.entity_type = 'sub_industry' AND e.taxonomy_node_id IS NOT NULL
),
sector_factor AS (
  SELECT id AS factor_id FROM factors WHERE key = 'sector_cycle_score' LIMIT 1
),
industry_factor AS (
  SELECT id AS factor_id FROM factors WHERE key = 'industry_cycle_score' LIMIT 1
),
sub_industry_factor AS (
  SELECT id AS factor_id FROM factors WHERE key = 'sub_industry_cycle_score' LIMIT 1
),
rows_sector AS (
  SELECT se.entity_id, sf.factor_id, p.period_key, p.period_months
  FROM sector_entities se
  CROSS JOIN sector_factor sf
  CROSS JOIN periods p
),
rows_industry AS (
  SELECT ie.entity_id, inf.factor_id, p.period_key, p.period_months
  FROM industry_entities ie
  CROSS JOIN industry_factor inf
  CROSS JOIN periods p
),
rows_sub AS (
  SELECT sub.entity_id, subf.factor_id, p.period_key, p.period_months
  FROM sub_industry_entities sub
  CROSS JOIN sub_industry_factor subf
  CROSS JOIN periods p
),
all_rows AS (
  SELECT entity_id, factor_id, period_key, period_months FROM rows_sector
  UNION ALL
  SELECT entity_id, factor_id, period_key, period_months FROM rows_industry
  UNION ALL
  SELECT entity_id, factor_id, period_key, period_months FROM rows_sub
)
INSERT INTO entity_factor_values (entity_id, factor_id, model_version, period_key, period_months, value_num, source, ingested_at)
SELECT
  r.entity_id,
  r.factor_id,
  'v1',
  r.period_key,
  r.period_months,
  0,
  'seed',
  now()
FROM all_rows r
ON CONFLICT (entity_id, factor_id, model_version, period_key) DO UPDATE SET
  value_num = EXCLUDED.value_num,
  period_months = EXCLUDED.period_months,
  source = EXCLUDED.source,
  ingested_at = EXCLUDED.ingested_at,
  updated_at = now();

COMMIT;
