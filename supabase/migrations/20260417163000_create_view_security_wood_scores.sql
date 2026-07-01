-- SKE-66: Read model view for active securities and latest Cathie Wood score

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
  WHERE f.key = 'alpha_galangal_committee_wood_score'
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
