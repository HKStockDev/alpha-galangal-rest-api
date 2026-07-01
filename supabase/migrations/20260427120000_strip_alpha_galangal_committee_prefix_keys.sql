-- Rename committee factor/formula/prompt keys: strip prefix "alpha_galangal_committee_"
-- (e.g. alpha_galangal_committee_graham_score -> graham_score, ..._llm -> llm).
-- Recreates v_security_* views that filter by factor key.

BEGIN;

UPDATE public.factors
SET key = regexp_replace(key, '^alpha_galangal_committee_', '')
WHERE key ~ '^alpha_galangal_committee_';

UPDATE public.formulas
SET key = regexp_replace(key, '^alpha_galangal_committee_', '')
WHERE key ~ '^alpha_galangal_committee_';

UPDATE public.prompts
SET key = regexp_replace(key, '^alpha_galangal_committee_', '')
WHERE key ~ '^alpha_galangal_committee_';

-- ---------------------------------------------------------------------------
-- Views: factor lookup by new key
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_security_buffett_scores AS
WITH active_securities AS (
  SELECT
    s.id AS security_id,
    s.entity_id,
    s.ticker,
    s.name AS security_name
  FROM public.securities s
  WHERE s.active = true
    AND s.entity_id IS NOT NULL
),
buffett_factor AS (
  SELECT f.id AS factor_id
  FROM public.factors f
  WHERE f.key = 'buffett_score'
  LIMIT 1
),
latest_buffett AS (
  SELECT
    efv.entity_id,
    efv.value_num                       AS buffett_score,
    efv.value_text                      AS buffett_payload_text,
    efv.updated_at                      AS buffett_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY efv.entity_id
      ORDER BY efv.updated_at DESC NULLS LAST
    ) AS rn
  FROM public.entity_factor_values efv
  JOIN buffett_factor bf ON bf.factor_id = efv.factor_id
)
SELECT
  a.security_id,
  a.entity_id,
  a.ticker,
  a.security_name,
  l.buffett_score,
  CASE
    WHEN l.buffett_score IS NULL THEN NULL
    WHEN l.buffett_score >= 70    THEN 'positive'
    WHEN l.buffett_score >= 40    THEN 'neutral'
    ELSE 'negative'
  END                                                                         AS buffett_label,
  CASE
    WHEN l.buffett_payload_text IS NOT NULL
    THEN ((l.buffett_payload_text)::jsonb ->> 'confidence')::numeric
    ELSE NULL
  END                                                                         AS buffett_confidence,
  CASE
    WHEN l.buffett_payload_text IS NOT NULL
    THEN (l.buffett_payload_text)::jsonb ->> 'summary'
    ELSE NULL
  END                                                                         AS buffett_summary,
  l.buffett_updated_at
FROM active_securities a
LEFT JOIN latest_buffett l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

CREATE OR REPLACE VIEW public.v_security_burry_scores AS
WITH active_securities AS (
  SELECT
    s.id AS security_id,
    s.entity_id,
    s.ticker,
    s.name AS security_name
  FROM public.securities s
  WHERE s.active = true
    AND s.entity_id IS NOT NULL
),
burry_factor AS (
  SELECT f.id AS factor_id
  FROM public.factors f
  WHERE f.key = 'burry_score'
  LIMIT 1
),
latest_burry AS (
  SELECT
    efv.entity_id,
    efv.value_num                       AS burry_score,
    efv.value_text                      AS burry_payload_text,
    efv.updated_at                      AS burry_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY efv.entity_id
      ORDER BY efv.updated_at DESC NULLS LAST
    ) AS rn
  FROM public.entity_factor_values efv
  JOIN burry_factor bf ON bf.factor_id = efv.factor_id
)
SELECT
  a.security_id,
  a.entity_id,
  a.ticker,
  a.security_name,
  l.burry_score,
  CASE
    WHEN l.burry_score IS NULL THEN NULL
    WHEN l.burry_score >= 70    THEN 'positive'
    WHEN l.burry_score >= 40    THEN 'neutral'
    ELSE 'negative'
  END                                                                         AS burry_label,
  CASE
    WHEN l.burry_payload_text IS NOT NULL
    THEN ((l.burry_payload_text)::jsonb ->> 'confidence')::numeric
    ELSE NULL
  END                                                                         AS burry_confidence,
  CASE
    WHEN l.burry_payload_text IS NOT NULL
    THEN (l.burry_payload_text)::jsonb ->> 'summary'
    ELSE NULL
  END                                                                         AS burry_summary,
  l.burry_updated_at
FROM active_securities a
LEFT JOIN latest_burry l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

CREATE OR REPLACE VIEW public.v_security_druckenmiller_scores AS
WITH active_securities AS (
  SELECT
    s.id AS security_id,
    s.entity_id,
    s.ticker,
    s.name AS security_name
  FROM public.securities s
  WHERE s.active = true
    AND s.entity_id IS NOT NULL
),
druckenmiller_factor AS (
  SELECT f.id AS factor_id
  FROM public.factors f
  WHERE f.key = 'druckenmiller_score'
  LIMIT 1
),
latest_druckenmiller AS (
  SELECT
    efv.entity_id,
    efv.value_num                         AS druckenmiller_score,
    efv.value_text                        AS druckenmiller_payload_text,
    efv.updated_at                        AS druckenmiller_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY efv.entity_id
      ORDER BY efv.updated_at DESC NULLS LAST
    ) AS rn
  FROM public.entity_factor_values efv
  JOIN druckenmiller_factor df ON df.factor_id = efv.factor_id
)
SELECT
  a.security_id,
  a.entity_id,
  a.ticker,
  a.security_name,
  l.druckenmiller_score,
  CASE
    WHEN l.druckenmiller_score IS NULL THEN NULL
    WHEN l.druckenmiller_score >= 70    THEN 'positive'
    WHEN l.druckenmiller_score >= 40    THEN 'neutral'
    ELSE 'negative'
  END                                                                               AS druckenmiller_label,
  CASE
    WHEN l.druckenmiller_payload_text IS NOT NULL
    THEN ((l.druckenmiller_payload_text)::jsonb ->> 'confidence')::numeric
    ELSE NULL
  END                                                                               AS druckenmiller_confidence,
  CASE
    WHEN l.druckenmiller_payload_text IS NOT NULL
    THEN (l.druckenmiller_payload_text)::jsonb ->> 'summary'
    ELSE NULL
  END                                                                               AS druckenmiller_summary,
  l.druckenmiller_updated_at
FROM active_securities a
LEFT JOIN latest_druckenmiller l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

CREATE OR REPLACE VIEW public.v_security_graham_scores AS
WITH active_securities AS (
  SELECT
    s.id AS security_id,
    s.entity_id,
    s.ticker,
    s.name AS security_name
  FROM public.securities s
  WHERE s.active = true
    AND s.entity_id IS NOT NULL
),
graham_factor AS (
  SELECT f.id AS factor_id
  FROM public.factors f
  WHERE f.key = 'graham_score'
  LIMIT 1
),
latest_graham AS (
  SELECT
    efv.entity_id,
    efv.value_num                       AS graham_score,
    efv.value_text                      AS graham_payload_text,
    efv.updated_at                      AS graham_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY efv.entity_id
      ORDER BY efv.updated_at DESC NULLS LAST
    ) AS rn
  FROM public.entity_factor_values efv
  JOIN graham_factor gf ON gf.factor_id = efv.factor_id
)
SELECT
  a.security_id,
  a.entity_id,
  a.ticker,
  a.security_name,
  l.graham_score,
  CASE
    WHEN l.graham_score IS NULL THEN NULL
    WHEN l.graham_score >= 70    THEN 'positive'
    WHEN l.graham_score >= 40    THEN 'neutral'
    ELSE 'negative'
  END                                                                         AS graham_label,
  CASE
    WHEN l.graham_payload_text IS NOT NULL
    THEN ((l.graham_payload_text)::jsonb ->> 'confidence')::numeric
    ELSE NULL
  END                                                                         AS graham_confidence,
  CASE
    WHEN l.graham_payload_text IS NOT NULL
    THEN (l.graham_payload_text)::jsonb ->> 'summary'
    ELSE NULL
  END                                                                         AS graham_summary,
  l.graham_updated_at
FROM active_securities a
LEFT JOIN latest_graham l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

CREATE OR REPLACE VIEW public.v_security_wood_scores AS
WITH active_securities AS (
  SELECT
    s.id AS security_id,
    s.entity_id,
    s.ticker,
    s.name AS security_name
  FROM public.securities s
  WHERE s.active = true
    AND s.entity_id IS NOT NULL
),
wood_factor AS (
  SELECT f.id AS factor_id
  FROM public.factors f
  WHERE f.key = 'wood_score'
  LIMIT 1
),
latest_wood AS (
  SELECT
    efv.entity_id,
    efv.value_num                       AS wood_score,
    efv.value_text                      AS wood_payload_text,
    efv.updated_at                      AS wood_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY efv.entity_id
      ORDER BY efv.updated_at DESC NULLS LAST
    ) AS rn
  FROM public.entity_factor_values efv
  JOIN wood_factor wf ON wf.factor_id = efv.factor_id
)
SELECT
  a.security_id,
  a.entity_id,
  a.ticker,
  a.security_name,
  l.wood_score,
  CASE
    WHEN l.wood_score IS NULL THEN NULL
    WHEN l.wood_score >= 70    THEN 'positive'
    WHEN l.wood_score >= 40    THEN 'neutral'
    ELSE 'negative'
  END                                                                         AS wood_label,
  CASE
    WHEN l.wood_payload_text IS NOT NULL
    THEN ((l.wood_payload_text)::jsonb ->> 'confidence')::numeric
    ELSE NULL
  END                                                                         AS wood_confidence,
  CASE
    WHEN l.wood_payload_text IS NOT NULL
    THEN (l.wood_payload_text)::jsonb ->> 'summary'
    ELSE NULL
  END                                                                         AS wood_summary,
  l.wood_updated_at
FROM active_securities a
LEFT JOIN latest_wood l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

CREATE OR REPLACE VIEW public.v_security_lynch_scores AS
WITH active_securities AS (
  SELECT
    s.id AS security_id,
    s.entity_id,
    s.ticker,
    s.name AS security_name
  FROM public.securities s
  WHERE s.active = true
    AND s.entity_id IS NOT NULL
),
lynch_factor AS (
  SELECT f.id AS factor_id
  FROM public.factors f
  WHERE f.key = 'lynch_score'
  LIMIT 1
),
latest_lynch AS (
  SELECT
    efv.entity_id,
    efv.value_num                       AS lynch_score,
    efv.value_text                      AS lynch_payload_text,
    efv.updated_at                      AS lynch_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY efv.entity_id
      ORDER BY efv.updated_at DESC NULLS LAST
    ) AS rn
  FROM public.entity_factor_values efv
  JOIN lynch_factor lf ON lf.factor_id = efv.factor_id
)
SELECT
  a.security_id,
  a.entity_id,
  a.ticker,
  a.security_name,
  l.lynch_score,
  CASE
    WHEN l.lynch_score IS NULL THEN NULL
    WHEN l.lynch_score >= 70    THEN 'positive'
    WHEN l.lynch_score >= 40    THEN 'neutral'
    ELSE 'negative'
  END                                                                         AS lynch_label,
  CASE
    WHEN l.lynch_payload_text IS NOT NULL
    THEN ((l.lynch_payload_text)::jsonb ->> 'confidence')::numeric
    ELSE NULL
  END                                                                         AS lynch_confidence,
  CASE
    WHEN l.lynch_payload_text IS NOT NULL
    THEN (l.lynch_payload_text)::jsonb ->> 'summary'
    ELSE NULL
  END                                                                         AS lynch_summary,
  l.lynch_updated_at
FROM active_securities a
LEFT JOIN latest_lynch l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

COMMIT;
