-- SKE-78: total row count for org screener (same filters as list_org_screenable_securities).

CREATE OR REPLACE FUNCTION public.count_org_screenable_securities(
  p_tag_ids uuid[],
  p_search text
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
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
    );
$$;

COMMENT ON FUNCTION public.count_org_screenable_securities IS
  'Count of active US equities matching optional tag filter and search (pair to list_org_screenable_securities).';

REVOKE ALL ON FUNCTION public.count_org_screenable_securities(uuid[], text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.count_org_screenable_securities(uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_org_screenable_securities(uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_org_screenable_securities(uuid[], text) TO anon;

NOTIFY pgrst, 'reload schema';
