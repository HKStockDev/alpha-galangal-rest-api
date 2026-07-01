-- SKE-78: efficient listing of active US equities with optional tag intersection (any selected tag).

CREATE OR REPLACE FUNCTION public.list_org_screenable_securities(
  p_tag_ids uuid[],
  p_search text,
  p_limit integer,
  p_offset integer
)
RETURNS TABLE (
  id uuid,
  ticker text,
  name text,
  market_cap numeric,
  primary_exchange text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.id, s.ticker, s.name, s.market_cap, s.primary_exchange
  FROM public.securities s
  WHERE s.active = true
    AND s.market = 'stocks'
    AND s.locale = 'us'
    AND (
      p_tag_ids IS NULL
      OR cardinality(p_tag_ids) = 0
      OR EXISTS (
        SELECT 1
        FROM public.security_tags st
        WHERE st.security_id = s.id
          AND st.tag_id = ANY (p_tag_ids)
      )
    )
    AND (
      p_search IS NULL
      OR length(trim(p_search)) = 0
      OR s.ticker ILIKE '%' || trim(p_search) || '%'
      OR s.name ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY s.ticker
  LIMIT CASE
    WHEN p_limit IS NULL OR p_limit < 1 THEN 100
    WHEN p_limit > 500 THEN 500
    ELSE p_limit
  END
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.list_org_screenable_securities IS
  'Lists active US equities; optional tag_ids restrict to securities with at least one matching security_tags row. Used by org screener (SKE-78).';

REVOKE ALL ON FUNCTION public.list_org_screenable_securities(uuid[], text, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_org_screenable_securities(uuid[], text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_org_screenable_securities(uuid[], text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_org_screenable_securities(uuid[], text, integer, integer) TO anon;
