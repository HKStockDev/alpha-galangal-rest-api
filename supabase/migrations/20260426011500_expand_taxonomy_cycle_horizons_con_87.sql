BEGIN;

-- CON-87 follow-up: allow 1m / 3m horizons in org equities RPC filters.

DROP FUNCTION IF EXISTS public.list_organization_equities_v2(
  uuid[], text, integer, integer, text, integer[], integer[], integer[]
);

CREATE OR REPLACE FUNCTION public.list_organization_equities_v2(
  p_tag_ids uuid[],
  p_search text,
  p_limit integer,
  p_offset integer,
  p_cycle_horizon text,
  p_sector_cycles integer[],
  p_industry_cycles integer[],
  p_sub_industry_cycles integer[]
)
RETURNS TABLE (
  id uuid,
  ticker text,
  name text,
  market_cap numeric,
  primary_exchange text,
  sector_title text,
  industry_title text,
  sub_industry_title text,
  sector_cycle integer,
  industry_cycle integer,
  sub_industry_cycle integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH RECURSIVE hz AS (
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_cycle_horizon, ''))) IN ('1m', '3m', '6m', '12m', '24m')
      THEN lower(btrim(COALESCE(p_cycle_horizon, '')))
    ELSE '24m'
  END AS period_k
),
base AS (
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
      OR length(btrim(p_search)) = 0
      OR s.ticker ILIKE '%' || btrim(p_search) || '%'
      OR s.name ILIKE '%' || btrim(p_search) || '%'
    )
),
latest_class AS (
  SELECT DISTINCT ON (sc.security_id)
    sc.security_id,
    sc.taxonomy_node_id
  FROM public.security_classifications sc
  INNER JOIN base b ON b.id = sc.security_id
  ORDER BY sc.security_id, sc.as_of_date DESC NULLS LAST, sc.updated_at DESC, sc.created_at DESC
),
rec AS (
  SELECT lc.security_id, n.node_id, n.level, n.parent_node_id
  FROM latest_class lc
  INNER JOIN public.taxonomy_nodes n ON n.node_id = lc.taxonomy_node_id
  UNION ALL
  SELECT r.security_id, p.node_id, p.level, p.parent_node_id
  FROM rec r
  INNER JOIN public.taxonomy_nodes p ON p.node_id = r.parent_node_id
  WHERE r.parent_node_id IS NOT NULL
),
scores AS (
  SELECT
    lc.security_id,
    (
      SELECT efv.value_num
      FROM rec r
      INNER JOIN public.entities e ON e.taxonomy_node_id = r.node_id AND e.entity_type = r.level
      INNER JOIN public.entity_factor_values efv ON efv.entity_id = e.id
      INNER JOIN public.factors f ON f.id = efv.factor_id AND f.key = 'sector_cycle_score'
      CROSS JOIN hz
      WHERE r.security_id = lc.security_id
        AND r.level = 'sector'
        AND efv.model_version = 'v1'
        AND lower(efv.period_key) = hz.period_k
      LIMIT 1
    ) AS sector_v,
    (
      SELECT efv.value_num
      FROM rec r
      INNER JOIN public.entities e ON e.taxonomy_node_id = r.node_id AND e.entity_type = r.level
      INNER JOIN public.entity_factor_values efv ON efv.entity_id = e.id
      INNER JOIN public.factors f ON f.id = efv.factor_id AND f.key = 'industry_cycle_score'
      CROSS JOIN hz
      WHERE r.security_id = lc.security_id
        AND r.level = 'industry'
        AND efv.model_version = 'v1'
        AND lower(efv.period_key) = hz.period_k
      LIMIT 1
    ) AS industry_v,
    (
      SELECT efv.value_num
      FROM rec r
      INNER JOIN public.entities e ON e.taxonomy_node_id = r.node_id AND e.entity_type = r.level
      INNER JOIN public.entity_factor_values efv ON efv.entity_id = e.id
      INNER JOIN public.factors f ON f.id = efv.factor_id AND f.key = 'sub_industry_cycle_score'
      CROSS JOIN hz
      WHERE r.security_id = lc.security_id
        AND r.level = 'sub_industry'
        AND efv.model_version = 'v1'
        AND lower(efv.period_key) = hz.period_k
      LIMIT 1
    ) AS sub_v
  FROM latest_class lc
),
tax_names AS (
  SELECT
    lc.security_id,
    (
      SELECT n.title
      FROM rec r
      INNER JOIN public.taxonomy_nodes n ON n.node_id = r.node_id
      WHERE r.security_id = lc.security_id
        AND r.level = 'sector'
      LIMIT 1
    ) AS sector_title,
    (
      SELECT n.title
      FROM rec r
      INNER JOIN public.taxonomy_nodes n ON n.node_id = r.node_id
      WHERE r.security_id = lc.security_id
        AND r.level = 'industry'
      LIMIT 1
    ) AS industry_title,
    (
      SELECT n.title
      FROM rec r
      INNER JOIN public.taxonomy_nodes n ON n.node_id = r.node_id
      WHERE r.security_id = lc.security_id
        AND r.level = 'sub_industry'
      LIMIT 1
    ) AS sub_industry_title
  FROM latest_class lc
),
filtered AS (
  SELECT b.id, b.ticker, b.name, b.market_cap, b.primary_exchange
  FROM base b
  LEFT JOIN latest_class lc ON lc.security_id = b.id
  LEFT JOIN scores sc ON sc.security_id = b.id
  WHERE NOT (
      cardinality(COALESCE(p_sector_cycles, ARRAY[]::integer[])) > 0
      OR cardinality(COALESCE(p_industry_cycles, ARRAY[]::integer[])) > 0
      OR cardinality(COALESCE(p_sub_industry_cycles, ARRAY[]::integer[])) > 0
    )
    OR (
      lc.security_id IS NOT NULL
      AND (
        cardinality(COALESCE(p_sector_cycles, ARRAY[]::integer[])) = 0
        OR (
          sc.sector_v IS NOT NULL
          AND round(sc.sector_v)::integer = ANY (COALESCE(p_sector_cycles, ARRAY[]::integer[]))
        )
      )
      AND (
        cardinality(COALESCE(p_industry_cycles, ARRAY[]::integer[])) = 0
        OR (
          sc.industry_v IS NOT NULL
          AND round(sc.industry_v)::integer = ANY (COALESCE(p_industry_cycles, ARRAY[]::integer[]))
        )
      )
      AND (
        cardinality(COALESCE(p_sub_industry_cycles, ARRAY[]::integer[])) = 0
        OR (
          sc.sub_v IS NOT NULL
          AND round(sc.sub_v)::integer = ANY (COALESCE(p_sub_industry_cycles, ARRAY[]::integer[]))
        )
      )
    )
)
SELECT
  f.id,
  f.ticker,
  f.name,
  f.market_cap,
  f.primary_exchange,
  tn.sector_title,
  tn.industry_title,
  tn.sub_industry_title,
  CASE WHEN sc.sector_v IS NULL THEN NULL ELSE round(sc.sector_v)::integer END AS sector_cycle,
  CASE WHEN sc.industry_v IS NULL THEN NULL ELSE round(sc.industry_v)::integer END AS industry_cycle,
  CASE WHEN sc.sub_v IS NULL THEN NULL ELSE round(sc.sub_v)::integer END AS sub_industry_cycle
FROM filtered f
LEFT JOIN scores sc ON sc.security_id = f.id
LEFT JOIN tax_names tn ON tn.security_id = f.id
ORDER BY f.ticker
LIMIT CASE
  WHEN p_limit IS NULL OR p_limit < 1 THEN 101
  WHEN p_limit > 500 THEN 501
  ELSE p_limit + 1
END
OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.list_organization_equities_v2(
  uuid[], text, integer, integer, text, integer[], integer[], integer[]
) IS
  'SKE-43/CON-87: active US equities with optional tag filter, search, and taxonomy cycle filters (1m/3m/6m/12m/24m). '
  'Returns taxonomy titles and rounded cycle scores for the requested horizon, plus up to limit+1 rows for has_more.';

CREATE OR REPLACE FUNCTION public.count_organization_equities_v2(
  p_tag_ids uuid[],
  p_search text,
  p_cycle_horizon text,
  p_sector_cycles integer[],
  p_industry_cycles integer[],
  p_sub_industry_cycles integer[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH RECURSIVE hz AS (
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_cycle_horizon, ''))) IN ('1m', '3m', '6m', '12m', '24m')
      THEN lower(btrim(COALESCE(p_cycle_horizon, '')))
    ELSE '24m'
  END AS period_k
),
base AS (
  SELECT s.id
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
      OR length(btrim(p_search)) = 0
      OR s.ticker ILIKE '%' || btrim(p_search) || '%'
      OR s.name ILIKE '%' || btrim(p_search) || '%'
    )
),
latest_class AS (
  SELECT DISTINCT ON (sc.security_id)
    sc.security_id,
    sc.taxonomy_node_id
  FROM public.security_classifications sc
  INNER JOIN base b ON b.id = sc.security_id
  ORDER BY sc.security_id, sc.as_of_date DESC NULLS LAST, sc.updated_at DESC, sc.created_at DESC
),
rec AS (
  SELECT lc.security_id, n.node_id, n.level, n.parent_node_id
  FROM latest_class lc
  INNER JOIN public.taxonomy_nodes n ON n.node_id = lc.taxonomy_node_id
  UNION ALL
  SELECT r.security_id, p.node_id, p.level, p.parent_node_id
  FROM rec r
  INNER JOIN public.taxonomy_nodes p ON p.node_id = r.parent_node_id
  WHERE r.parent_node_id IS NOT NULL
),
scores AS (
  SELECT
    lc.security_id,
    (
      SELECT efv.value_num
      FROM rec r
      INNER JOIN public.entities e ON e.taxonomy_node_id = r.node_id AND e.entity_type = r.level
      INNER JOIN public.entity_factor_values efv ON efv.entity_id = e.id
      INNER JOIN public.factors f ON f.id = efv.factor_id AND f.key = 'sector_cycle_score'
      CROSS JOIN hz
      WHERE r.security_id = lc.security_id
        AND r.level = 'sector'
        AND efv.model_version = 'v1'
        AND lower(efv.period_key) = hz.period_k
      LIMIT 1
    ) AS sector_v,
    (
      SELECT efv.value_num
      FROM rec r
      INNER JOIN public.entities e ON e.taxonomy_node_id = r.node_id AND e.entity_type = r.level
      INNER JOIN public.entity_factor_values efv ON efv.entity_id = e.id
      INNER JOIN public.factors f ON f.id = efv.factor_id AND f.key = 'industry_cycle_score'
      CROSS JOIN hz
      WHERE r.security_id = lc.security_id
        AND r.level = 'industry'
        AND efv.model_version = 'v1'
        AND lower(efv.period_key) = hz.period_k
      LIMIT 1
    ) AS industry_v,
    (
      SELECT efv.value_num
      FROM rec r
      INNER JOIN public.entities e ON e.taxonomy_node_id = r.node_id AND e.entity_type = r.level
      INNER JOIN public.entity_factor_values efv ON efv.entity_id = e.id
      INNER JOIN public.factors f ON f.id = efv.factor_id AND f.key = 'sub_industry_cycle_score'
      CROSS JOIN hz
      WHERE r.security_id = lc.security_id
        AND r.level = 'sub_industry'
        AND efv.model_version = 'v1'
        AND lower(efv.period_key) = hz.period_k
      LIMIT 1
    ) AS sub_v
  FROM latest_class lc
),
filtered AS (
  SELECT b.id
  FROM base b
  LEFT JOIN latest_class lc ON lc.security_id = b.id
  LEFT JOIN scores sc ON sc.security_id = b.id
  WHERE NOT (
      cardinality(COALESCE(p_sector_cycles, ARRAY[]::integer[])) > 0
      OR cardinality(COALESCE(p_industry_cycles, ARRAY[]::integer[])) > 0
      OR cardinality(COALESCE(p_sub_industry_cycles, ARRAY[]::integer[])) > 0
    )
    OR (
      lc.security_id IS NOT NULL
      AND (
        cardinality(COALESCE(p_sector_cycles, ARRAY[]::integer[])) = 0
        OR (
          sc.sector_v IS NOT NULL
          AND round(sc.sector_v)::integer = ANY (COALESCE(p_sector_cycles, ARRAY[]::integer[]))
        )
      )
      AND (
        cardinality(COALESCE(p_industry_cycles, ARRAY[]::integer[])) = 0
        OR (
          sc.industry_v IS NOT NULL
          AND round(sc.industry_v)::integer = ANY (COALESCE(p_industry_cycles, ARRAY[]::integer[]))
        )
      )
      AND (
        cardinality(COALESCE(p_sub_industry_cycles, ARRAY[]::integer[])) = 0
        OR (
          sc.sub_v IS NOT NULL
          AND round(sc.sub_v)::integer = ANY (COALESCE(p_sub_industry_cycles, ARRAY[]::integer[]))
        )
      )
    )
)
SELECT COUNT(*)::bigint FROM filtered;
$$;

COMMENT ON FUNCTION public.count_organization_equities_v2(
  uuid[], text, text, integer[], integer[], integer[]
) IS
  'SKE-43/CON-87: count rows matching list_organization_equities_v2 filters (supports 1m/3m/6m/12m/24m horizon).';

REVOKE ALL ON FUNCTION public.list_organization_equities_v2(
  uuid[], text, integer, integer, text, integer[], integer[], integer[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_organization_equities_v2(
  uuid[], text, integer, integer, text, integer[], integer[], integer[]
) TO service_role;

GRANT EXECUTE ON FUNCTION public.list_organization_equities_v2(
  uuid[], text, integer, integer, text, integer[], integer[], integer[]
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.list_organization_equities_v2(
  uuid[], text, integer, integer, text, integer[], integer[], integer[]
) TO anon;

REVOKE ALL ON FUNCTION public.count_organization_equities_v2(
  uuid[], text, text, integer[], integer[], integer[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.count_organization_equities_v2(
  uuid[], text, text, integer[], integer[], integer[]
) TO service_role;

GRANT EXECUTE ON FUNCTION public.count_organization_equities_v2(
  uuid[], text, text, integer[], integer[], integer[]
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.count_organization_equities_v2(
  uuid[], text, text, integer[], integer[], integer[]
) TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
