-- SKE-67: Read model view for active securities and latest Druckenmiller score

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
  WHERE f.key = 'alpha_galangal_committee_druckenmiller_score'
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
