-- SKE-62: Read model view for active securities and latest Peter Lynch score

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
  WHERE f.key = 'alpha_galangal_committee_lynch_score'
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
