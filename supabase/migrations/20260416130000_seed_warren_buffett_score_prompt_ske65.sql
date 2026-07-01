-- SKE-65: Seed Warren Buffett score prompt for alpha_galangal_committee_buffett_score

DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
  v_formula_id uuid;
  v_prompt_id uuid;
  v_pv_id uuid;
  v_schema jsonb := jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array(
      'model',
      'score',
      'label',
      'confidence',
      'dimensions',
      'reasons_for',
      'reasons_against',
      'summary'
    ),
    'properties', jsonb_build_object(
      'model', jsonb_build_object('type', 'string'),
      'score', jsonb_build_object('type', 'number'),
      'label', jsonb_build_object('type', 'string'),
      'confidence', jsonb_build_object('type', 'number'),
      'dimensions', jsonb_build_object(
        'type', 'object',
        'required', jsonb_build_array(
          'business_predictability',
          'competitive_advantage',
          'earnings_consistency',
          'capital_efficiency',
          'balance_sheet_strength'
        ),
        'properties', jsonb_build_object(
          'business_predictability', jsonb_build_object('type', 'number'),
          'competitive_advantage', jsonb_build_object('type', 'number'),
          'earnings_consistency', jsonb_build_object('type', 'number'),
          'capital_efficiency', jsonb_build_object('type', 'number'),
          'balance_sheet_strength', jsonb_build_object('type', 'number')
        )
      ),
      'reasons_for', jsonb_build_object('type', 'array'),
      'reasons_against', jsonb_build_object('type', 'array'),
      'summary', jsonb_build_object('type', 'string')
    )
  );
  v_user_prompt text := $prompt$
You are evaluating whether {{ticker}} fits the investment style of Warren Buffett.
Score the company from 0 to 100 based on how strongly it matches Buffett-style investing principles.
Focus on:
business predictability
durable competitive advantage
consistent earnings
high returns on capital
strong balance sheet
long-term operating stability
shareholder-friendly capital allocation
Penalize:
cyclical earnings
weak balance sheet
commodity exposure
unpredictable business models
frequent dilution
short operating history
Use conservative judgment when information is unclear.
Return JSON only.
Schema:
{
"model": "buffett",
"score": 0,
"label": "positive | neutral | negative",
"confidence": 0.0,
"dimensions": {
"business_predictability": 0,
"competitive_advantage": 0,
"earnings_consistency": 0,
"capital_efficiency": 0,
"balance_sheet_strength": 0
},
"reasons_for": [],
"reasons_against": [],
"summary": ""
}
Rules:
score >= 70 -> positive
40-69 -> neutral
< 40 -> negative
confidence between 0.0 and 1.0
Return JSON only.
$prompt$;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'seed_warren_buffett_score_prompt_ske65: no organizations; skip';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id
  FROM public.signal_categories
  WHERE organization_id = v_org_id AND name = 'BUSINESS_QUALITY'
  LIMIT 1;

  IF v_cat_id IS NULL THEN
    SELECT id INTO v_cat_id
    FROM public.signal_categories
    WHERE organization_id = v_org_id
    ORDER BY name
    LIMIT 1;
  END IF;

  INSERT INTO public.formulas (
    organization_id,
    category_id,
    key,
    name,
    output_type,
    definition,
    display_formula,
    description,
    visibility,
    formula_level,
    execution_type,
    version,
    is_active
  )
  VALUES (
    v_org_id,
    v_cat_id,
    'alpha_galangal_committee_buffett_score',
    'Alpha Galangal Committee: Buffett Score',
    'number',
    jsonb_build_object('type', 'llm', 'model', 'buffett'),
    'LLM Buffett score (0-100)',
    'Buffett-style subscore used by Alpha Galangal Committee.',
    'organization',
    'MASTER_MODEL',
    'llm',
    1,
    true
  )
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        output_type = EXCLUDED.output_type,
        definition = EXCLUDED.definition,
        display_formula = EXCLUDED.display_formula,
        description = EXCLUDED.description,
        updated_at = now()
  RETURNING id INTO v_formula_id;

  IF v_formula_id IS NULL THEN
    SELECT id INTO v_formula_id
    FROM public.formulas
    WHERE key = 'alpha_galangal_committee_buffett_score'
    LIMIT 1;
  END IF;

  INSERT INTO public.prompts (organization_id, key, category, name, description)
  VALUES (
    v_org_id,
    'alpha_galangal_committee_buffett_score',
    'formula',
    'Warren Buffett Score',
    'LLM prompt for Buffett-style score (0-100) with label, confidence, dimensions, and reasons.'
  )
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now()
  RETURNING id INTO v_prompt_id;

  IF v_prompt_id IS NULL THEN
    SELECT id INTO v_prompt_id
    FROM public.prompts
    WHERE key = 'alpha_galangal_committee_buffett_score'
    LIMIT 1;
  END IF;

  INSERT INTO public.prompt_versions (
    organization_id,
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
    max_output_tokens
  )
  SELECT
    v_org_id,
    v_prompt_id,
    1,
    'active',
    'You are a conservative equity analyst focused on Buffett-style quality and durability.',
    v_user_prompt,
    v_schema,
    'SKE-65 seed prompt',
    'gemini-2.0-flash',
    0.2,
    NULL,
    1024
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.prompt_versions pv
    WHERE pv.prompt_id = v_prompt_id
      AND pv.version = 1
  )
  RETURNING id INTO v_pv_id;

  IF v_pv_id IS NULL THEN
    SELECT id INTO v_pv_id
    FROM public.prompt_versions
    WHERE prompt_id = v_prompt_id
      AND version = 1
    LIMIT 1;
  END IF;

  UPDATE public.prompts
  SET active_prompt_version_id = v_pv_id,
      updated_at = now()
  WHERE id = v_prompt_id;
END $$;
