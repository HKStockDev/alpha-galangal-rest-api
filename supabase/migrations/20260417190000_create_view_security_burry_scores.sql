-- SKE-63: Read model view for active securities and latest Michael Burry score

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
  WHERE f.key = 'alpha_galangal_committee_burry_score'
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
