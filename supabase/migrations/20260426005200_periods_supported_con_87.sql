BEGIN;

-- 1) Remove previous check first (it may reject the new canonical value)
ALTER TABLE public.factors
  DROP CONSTRAINT IF EXISTS chk_factors_period_supported;

-- 2) Canonicalize period_supported values for cycle factors
UPDATE public.factors
SET period_supported = '1,3,6,12,24'
WHERE key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')
  AND period_supported = '6,12,24';

-- 3) Re-create check with canonical bundle
ALTER TABLE public.factors
  ADD CONSTRAINT chk_factors_period_supported
  CHECK (
    period_supported IN (
      'quarterly',
      'annual',
      'both',
      'none',
      '1,3,6,12,24',
      'multi'
    )
  );

-- 4) Backfill 1m and 3m rows for existing cycle factor values (snapshot table)
--    Uses current 6m value as an interim proxy so consumers can query immediately.
WITH cycle_factor_ids AS (
  SELECT id
  FROM public.factors
  WHERE key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')
),
source_rows AS (
  SELECT
    efv.entity_id,
    efv.factor_id,
    efv.model_version,
    efv.value_num,
    efv.value_text,
    efv.updated_at,
    efv.source,
    efv.ingested_at
  FROM public.entity_factor_values efv
  JOIN cycle_factor_ids cfi ON cfi.id = efv.factor_id
  WHERE efv.period_key = '6m'
),
target_periods AS (
  SELECT * FROM (VALUES ('1m'::text, 1), ('3m'::text, 3)) AS t(period_key, period_months)
)
INSERT INTO public.entity_factor_values (
  entity_id,
  factor_id,
  model_version,
  period_key,
  period_months,
  value_num,
  value_text,
  updated_at,
  source,
  ingested_at
)
SELECT
  s.entity_id,
  s.factor_id,
  s.model_version,
  tp.period_key,
  tp.period_months,
  s.value_num,
  s.value_text,
  now(),
  COALESCE(s.source, 'migration') || ':copied_from_6m',
  COALESCE(s.ingested_at, now())
FROM source_rows s
CROSS JOIN target_periods tp
ON CONFLICT (entity_id, factor_id, model_version, period_key) DO NOTHING;

-- 5) Create new active prompt versions for cycle prompts that include 1m + 3m
WITH cycle_prompts AS (
  SELECT p.id AS prompt_id, p.key, p.organization_id
  FROM public.prompts p
  WHERE p.key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')
),
next_versions AS (
  SELECT
    cp.prompt_id,
    cp.key,
    cp.organization_id,
    COALESCE(MAX(pv.version), 0) + 1 AS next_version
  FROM cycle_prompts cp
  LEFT JOIN public.prompt_versions pv ON pv.prompt_id = cp.prompt_id
  GROUP BY cp.prompt_id, cp.key, cp.organization_id
),
inserted AS (
  INSERT INTO public.prompt_versions (
    prompt_id,
    version,
    status,
    system_prompt,
    user_prompt_template,
    output_schema,
    notes,
    model_name,
    temperature,
    top_p,
    max_output_tokens,
    created_at,
    organization_id
  )
  SELECT
    nv.prompt_id,
    nv.next_version,
    'active',
    'You are a cycle analyst. For the given taxonomy level (sector, industry, or sub-industry), output a cycle score for each horizon. Use only: 1 (positive), 0 (neutral), -1 (negative). Return JSON only.',
    'Taxonomy level: {{level}}
Name: {{name}}
Code: {{code}}
Description: {{description}}

Output cycle scores for 1-month, 3-month, 6-month, 12-month, and 24-month horizons.
Use only 1, 0, or -1.

Return JSON: {"1m": <1|0|-1>, "3m": <1|0|-1>, "6m": <1|0|-1>, "12m": <1|0|-1>, "24m": <1|0|-1>}',
    '{"type":"object","required":["1m","3m","6m","12m","24m"],"properties":{"1m":{"enum":[1,0,-1]},"3m":{"enum":[1,0,-1]},"6m":{"enum":[1,0,-1]},"12m":{"enum":[1,0,-1]},"24m":{"enum":[1,0,-1]}}}'::jsonb,
    'Expanded horizons to 1m/3m/6m/12m/24m; supersedes earlier 6m/12m/24m-only prompt.',
    'gemini-2.0-flash',
    0.2,
    NULL,
    256,
    now(),
    nv.organization_id
  FROM next_versions nv
  RETURNING id, prompt_id
)
UPDATE public.prompts p
SET active_prompt_version_id = i.id,
    updated_at = now()
FROM inserted i
WHERE p.id = i.prompt_id;

COMMIT;
