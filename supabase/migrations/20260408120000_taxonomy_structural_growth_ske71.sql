-- SKE-71: Taxonomy structural growth (3y / 5y / 10y) — factors, formulas, prompts, prompt_versions
--
-- Apply on a machine that can reach Supabase Postgres (Cursor/agent often cannot resolve db.*.supabase.co):
--   cd alpha-galangal-rest-api
--   node scripts/apply-migration.cjs 20260408120000_taxonomy_structural_growth_ske71.sql
-- Requires .env or .env.development: SUPABASE_URL (or SUPABASE_PROJECT_ID) and POSTGRES_PASSWORD.

BEGIN;

ALTER TABLE public.factors DROP CONSTRAINT IF EXISTS chk_factors_statement_type;
ALTER TABLE public.factors ADD CONSTRAINT chk_factors_statement_type
  CHECK (statement_type IN (
    'income_statement',
    'balance_sheet',
    'cash_flow_statement',
    'financial_ratio',
    'market_data',
    'custom',
    'taxonomy_cycle',
    'taxonomy_structural_growth'
  ));

DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
  v_prompt_id uuid;
  v_pv_id uuid;
  v_user text := $tpl$Taxonomy level: {{level}}
Name: {{name}}
Code: {{code}}
Description: {{description}}

Return JSON only.$tpl$;
  v_schema jsonb := jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('horizon', 'cycle_signal', 'cagr_bucket', 'confidence', 'growth_drivers', 'structural_tailwinds', 'structural_headwinds', 'summary'),
    'properties', jsonb_build_object(
      'horizon', jsonb_build_object('type', 'string'),
      'cycle_signal', jsonb_build_object('type', 'integer'),
      'cagr_bucket', jsonb_build_object('type', 'string'),
      'confidence', jsonb_build_object('type', 'number'),
      'growth_drivers', jsonb_build_object('type', 'array'),
      'structural_tailwinds', jsonb_build_object('type', 'array'),
      'structural_headwinds', jsonb_build_object('type', 'array'),
      'summary', jsonb_build_object('type', 'string')
    )
  );
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'taxonomy_structural_growth_ske71: no organizations; skip';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id FROM public.signal_categories
  WHERE organization_id = v_org_id AND name = 'BUSINESS_QUALITY' LIMIT 1;
  IF v_cat_id IS NULL THEN
    SELECT id INTO v_cat_id FROM public.signal_categories
    WHERE organization_id = v_org_id ORDER BY name LIMIT 1;
  END IF;

  INSERT INTO public.factors (
    organization_id, key, name, value_type, description,
    data_grain, period_supported, statement_type
  )
  VALUES
    (v_org_id, 'sector_structural_growth', 'Sector structural growth (3y/5y/10y)', 'json',
     'LLM JSON payload: regime, CAGR bucket, confidence, drivers/risks per horizon.', 'sector', 'multi', 'taxonomy_structural_growth'),
    (v_org_id, 'industry_structural_growth', 'Industry structural growth (3y/5y/10y)', 'json',
     'LLM JSON payload: regime, CAGR bucket, confidence, drivers/risks per horizon.', 'industry', 'multi', 'taxonomy_structural_growth'),
    (v_org_id, 'sub_industry_structural_growth', 'Sub-industry structural growth (3y/5y/10y)', 'json',
     'LLM JSON payload: regime, CAGR bucket, confidence, drivers/risks per horizon.', 'sub_industry', 'multi', 'taxonomy_structural_growth')
  ON CONFLICT (key) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    data_grain = EXCLUDED.data_grain,
    period_supported = EXCLUDED.period_supported,
    statement_type = EXCLUDED.statement_type;

  INSERT INTO public.formulas (
    organization_id, category_id, key, name, output_type, definition,
    display_formula, description, visibility, formula_level, execution_type, version, is_active
  )
  VALUES
    (v_org_id, v_cat_id, 'taxonomy_structural_growth_3y', 'Taxonomy structural growth (3y)', 'json',
     jsonb_build_object('type', 'llm', 'horizon', '3y'),
     'LLM 3y', 'Forward-looking structural growth for taxonomy nodes (3y).', 'organization', 'MASTER_MODEL', 'llm', 1, true),
    (v_org_id, v_cat_id, 'taxonomy_structural_growth_5y', 'Taxonomy structural growth (5y)', 'json',
     jsonb_build_object('type', 'llm', 'horizon', '5y'),
     'LLM 5y', 'Forward-looking structural growth for taxonomy nodes (5y).', 'organization', 'MASTER_MODEL', 'llm', 1, true),
    (v_org_id, v_cat_id, 'taxonomy_structural_growth_10y', 'Taxonomy structural growth (10y)', 'json',
     jsonb_build_object('type', 'llm', 'horizon', '10y'),
     'LLM 10y', 'Forward-looking structural growth for taxonomy nodes (10y).', 'organization', 'MASTER_MODEL', 'llm', 1, true)
  ON CONFLICT (key) DO NOTHING;

  -- 3y prompt
  INSERT INTO public.prompts (organization_id, key, category, name, description)
  VALUES (v_org_id, 'taxonomy_structural_growth_3y', 'taxonomy', 'Structural growth 3y',
          'LLM: 3y structural growth regime and CAGR bucket for sector/industry/sub-industry.')
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
  RETURNING id INTO v_prompt_id;
  IF v_prompt_id IS NULL THEN
    SELECT id INTO v_prompt_id FROM public.prompts WHERE key = 'taxonomy_structural_growth_3y';
  END IF;

  INSERT INTO public.prompt_versions (
    organization_id, prompt_id, version, status,
    system_prompt, user_prompt_template, output_schema, notes,
    model_name, temperature, top_p, max_output_tokens
  )
  SELECT
    v_org_id,
    v_prompt_id,
    1,
    'active',
    $s3$You are evaluating the forward-looking structural growth outlook of a market classification node over a 3-year horizon.
The node may represent a sector, industry, or subindustry.
Your task is to estimate expected structural growth direction over the next 3 years.
Do NOT generate an exact CAGR number.
Instead:
classify expected growth regime
estimate a CAGR bucket range
provide confidence level
list supporting growth drivers
list structural risks
The 3-year horizon should reflect:
adoption acceleration already underway
earnings expansion trajectory
investment cycle continuation
policy support
near-term technological scaling
supply-demand imbalances
Use conservative judgment.
If signals conflict, lower confidence.
Return JSON only.
Growth regime definitions (map to cycle_signal):
1 = favorable growth regime
0 = neutral growth regime
-1 = unfavorable growth regime
Allowed CAGR bucket values (exactly one string for cagr_bucket):
declining (<0%)
0–5%
5–10%
10–20%
20%+
Return JSON only in this format:
{"horizon":"3y","cycle_signal":0,"cagr_bucket":"","confidence":0.0,"growth_drivers":[],"structural_tailwinds":[],"structural_headwinds":[],"summary":""}
Confidence must be between 0.0 and 1.0.
Do not fabricate statistics.
Prefer directional classification over precision.$s3$,
    v_user,
    v_schema,
    'SKE-71 seed 3y',
    'gemini-2.0-flash',
    0.2,
    NULL,
    1024
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_versions pv WHERE pv.prompt_id = v_prompt_id AND pv.version = 1
  )
  RETURNING id INTO v_pv_id;

  IF v_pv_id IS NULL THEN
    SELECT id INTO v_pv_id FROM public.prompt_versions WHERE prompt_id = v_prompt_id AND version = 1 LIMIT 1;
  END IF;
  UPDATE public.prompts SET active_prompt_version_id = v_pv_id, updated_at = now() WHERE id = v_prompt_id;

  -- 5y prompt
  v_prompt_id := NULL;
  v_pv_id := NULL;
  INSERT INTO public.prompts (organization_id, key, category, name, description)
  VALUES (v_org_id, 'taxonomy_structural_growth_5y', 'taxonomy', 'Structural growth 5y',
          'LLM: 5y structural growth regime and CAGR bucket for sector/industry/sub-industry.')
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
  RETURNING id INTO v_prompt_id;
  IF v_prompt_id IS NULL THEN
    SELECT id INTO v_prompt_id FROM public.prompts WHERE key = 'taxonomy_structural_growth_5y';
  END IF;

  INSERT INTO public.prompt_versions (
    organization_id, prompt_id, version, status,
    system_prompt, user_prompt_template, output_schema, notes,
    model_name, temperature, top_p, max_output_tokens
  )
  SELECT
    v_org_id,
    v_prompt_id,
    1,
    'active',
    $s5$You are evaluating the forward-looking structural growth outlook of a market classification node over a 5-year horizon.
The node may represent a sector, industry, or subindustry.
Your task is to estimate expected structural growth direction over the next 5 years.
Do NOT generate an exact CAGR number.
Instead:
classify expected growth regime
estimate a CAGR bucket range
provide confidence level
identify structural adoption drivers
identify structural risks
The 5-year horizon should reflect:
technology adoption curves
capital investment cycles
industry transformation speed
global demand trajectory
policy support durability
platform transitions
supply chain restructuring
Use structural reasoning rather than short-term cyclical reasoning.
Return JSON only.
Growth regime definitions (map to cycle_signal):
1 = favorable growth regime
0 = neutral growth regime
-1 = unfavorable growth regime
Allowed CAGR bucket values (exactly one string for cagr_bucket):
declining (<0%)
0–5%
5–10%
10–20%
20%+
Return JSON only in this format:
{"horizon":"5y","cycle_signal":0,"cagr_bucket":"","confidence":0.0,"growth_drivers":[],"structural_tailwinds":[],"structural_headwinds":[],"summary":""}
Confidence must be between 0.0 and 1.0.
Avoid speculative hype.
Prefer consensus-aligned structural drivers.$s5$,
    v_user,
    v_schema,
    'SKE-71 seed 5y',
    'gemini-2.0-flash',
    0.2,
    NULL,
    1024
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_versions pv WHERE pv.prompt_id = v_prompt_id AND pv.version = 1
  )
  RETURNING id INTO v_pv_id;

  IF v_pv_id IS NULL THEN
    SELECT id INTO v_pv_id FROM public.prompt_versions WHERE prompt_id = v_prompt_id AND version = 1 LIMIT 1;
  END IF;
  UPDATE public.prompts SET active_prompt_version_id = v_pv_id, updated_at = now() WHERE id = v_prompt_id;

  -- 10y prompt
  v_prompt_id := NULL;
  v_pv_id := NULL;
  INSERT INTO public.prompts (organization_id, key, category, name, description)
  VALUES (v_org_id, 'taxonomy_structural_growth_10y', 'taxonomy', 'Structural growth 10y',
          'LLM: 10y structural growth regime and CAGR bucket for sector/industry/sub-industry.')
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
  RETURNING id INTO v_prompt_id;
  IF v_prompt_id IS NULL THEN
    SELECT id INTO v_prompt_id FROM public.prompts WHERE key = 'taxonomy_structural_growth_10y';
  END IF;

  INSERT INTO public.prompt_versions (
    organization_id, prompt_id, version, status,
    system_prompt, user_prompt_template, output_schema, notes,
    model_name, temperature, top_p, max_output_tokens
  )
  SELECT
    v_org_id,
    v_prompt_id,
    1,
    'active',
    $s10$You are evaluating the long-term structural growth outlook of a market classification node over a 10-year horizon.
The node may represent a sector, industry, or subindustry.
Your task is to estimate expected structural growth direction over the next 10 years.
Do NOT generate an exact CAGR number.
Instead:
classify expected structural trajectory
estimate a long-term CAGR bucket range
provide confidence level
identify secular tailwinds
identify secular risks
The 10-year horizon should reflect:
demographic trends
automation adoption
AI integration
energy transition
deflationary technologies
infrastructure shifts
geopolitical restructuring
platform-level innovation cycles
Use long-term structural reasoning.
Avoid short-term cyclical signals.
Return JSON only.
Growth regime definitions (map to cycle_signal):
1 = favorable structural regime
0 = neutral structural regime
-1 = unfavorable structural regime
Allowed CAGR bucket values (exactly one string for cagr_bucket):
declining (<0%)
0–5%
5–10%
10–20%
20%+
Return JSON only in this format:
{"horizon":"10y","cycle_signal":0,"cagr_bucket":"","confidence":0.0,"growth_drivers":[],"structural_tailwinds":[],"structural_headwinds":[],"summary":""}
Confidence must be between 0.0 and 1.0.
Prefer structural consensus trends over speculative projections.$s10$,
    v_user,
    v_schema,
    'SKE-71 seed 10y',
    'gemini-2.0-flash',
    0.2,
    NULL,
    1024
  WHERE NOT EXISTS (
    SELECT 1 FROM public.prompt_versions pv WHERE pv.prompt_id = v_prompt_id AND pv.version = 1
  )
  RETURNING id INTO v_pv_id;

  IF v_pv_id IS NULL THEN
    SELECT id INTO v_pv_id FROM public.prompt_versions WHERE prompt_id = v_prompt_id AND version = 1 LIMIT 1;
  END IF;
  UPDATE public.prompts SET active_prompt_version_id = v_pv_id, updated_at = now() WHERE id = v_prompt_id;

END $$;

COMMIT;
