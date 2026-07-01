-- SKE-68: Read model view for active securities and latest Benjamin Graham score

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
  WHERE f.key = 'alpha_galangal_committee_graham_score'
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
