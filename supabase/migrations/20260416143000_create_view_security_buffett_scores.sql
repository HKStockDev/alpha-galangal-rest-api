-- SKE-65: Read model view for active securities and latest Buffett score

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
  WHERE f.key = 'alpha_galangal_committee_buffett_score'
  LIMIT 1
),
latest_buffett AS (
  SELECT
    efv.entity_id,
    efv.value_num AS buffett_score,
    efv.value_text AS buffett_payload_text,
    efv.updated_at AS buffett_updated_at,
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
    WHEN l.buffett_score >= 70 THEN 'positive'
    WHEN l.buffett_score >= 40 THEN 'neutral'
    ELSE 'negative'
  END AS buffett_label,
  NULL::numeric AS buffett_confidence,
  NULL::text AS buffett_summary,
  l.buffett_updated_at
FROM active_securities a
LEFT JOIN latest_buffett l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

