-- SKE-67: Seed Stanley Druckenmiller score prompt for alpha_galangal_committee_druckenmiller_score

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
          'industry_cycle_alignment',
          'earnings_revision_direction',
          'sector_momentum',
          'macro_positioning'
        ),
        'properties', jsonb_build_object(
          'industry_cycle_alignment', jsonb_build_object('type', 'number'),
          'earnings_revision_direction', jsonb_build_object('type', 'number'),
          'sector_momentum', jsonb_build_object('type', 'number'),
          'macro_positioning', jsonb_build_object('type', 'number')
        )
      ),
      'reasons_for', jsonb_build_object('type', 'array'),
      'reasons_against', jsonb_build_object('type', 'array'),
      'summary', jsonb_build_object('type', 'string')
    )
  );
  v_user_prompt text := $prompt$
You are evaluating whether {{ticker}} fits the investment style of Stanley Druckenmiller.
Score the company from 0 to 100 based on how strongly it matches macro-aligned, regime-aware investing.
Focus on:
industry momentum
macro alignment
earnings revision direction
sector leadership
trend strength
positioning in favorable economic cycles
Penalize:
negative industry cycles
macro headwinds
weak earnings momentum
lagging sector positioning
Use conservative judgment when information is unclear.
Return JSON only.
Schema:
{
"model": "druckenmiller",
"score": 0,
"label": "positive | neutral | negative",
"confidence": 0.0,
"dimensions": {
"industry_cycle_alignment": 0,
"earnings_revision_direction": 0,
"sector_momentum": 0,
"macro_positioning": 0
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
    RAISE NOTICE 'seed_druckenmiller_score_prompt_ske67: no organizations; skip';
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
    'alpha_galangal_committee_druckenmiller_score',
    'Alpha Galangal Committee: Druckenmiller Score',
    'number',
    jsonb_build_object('type', 'llm', 'model', 'druckenmiller'),
    'LLM Druckenmiller score (0-100)',
    'Druckenmiller-style subscore used by Alpha Galangal Committee.',
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
    WHERE key = 'alpha_galangal_committee_druckenmiller_score'
    LIMIT 1;
  END IF;

  INSERT INTO public.prompts (organization_id, key, category, name, description)
  VALUES (
    v_org_id,
    'alpha_galangal_committee_druckenmiller_score',
    'formula',
    'Stanley Druckenmiller Score',
    'LLM prompt for Druckenmiller-style score (0-100) with label, confidence, dimensions, and reasons.'
  )
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now()
  RETURNING id INTO v_prompt_id;

  IF v_prompt_id IS NULL THEN
    SELECT id INTO v_prompt_id
    FROM public.prompts
    WHERE key = 'alpha_galangal_committee_druckenmiller_score'
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
    'You are a macro-focused equity analyst specialized in Druckenmiller-style regime-aware, momentum-driven investing.',
    v_user_prompt,
    v_schema,
    'SKE-67 seed prompt',
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
