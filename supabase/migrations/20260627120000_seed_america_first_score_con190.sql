-- CON-190: America First Score — factor, formula, prompt, view, sync schedule

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
      'score',
      'label',
      'confidence',
      'american_control',
      'american_economic_benefit',
      'strategic_importance',
      'penalties',
      'commentary'
    ),
    'properties', jsonb_build_object(
      'model', jsonb_build_object('type', 'string'),
      'score', jsonb_build_object('type', 'number'),
      'label', jsonb_build_object('type', 'string'),
      'confidence', jsonb_build_object('type', 'number'),
      'american_control', jsonb_build_object('type', 'object'),
      'american_economic_benefit', jsonb_build_object('type', 'object'),
      'strategic_importance', jsonb_build_object('type', 'object'),
      'penalties', jsonb_build_object('type', 'object'),
      'commentary', jsonb_build_object('type', 'string')
    )
  );
  v_user_prompt text := $prompt$
You are an equity research analyst.

Your task is to calculate an "America First Score" for publicly traded company {{ticker}} ({{company_name}}).

The goal is to estimate how strongly the company benefits, supports, and aligns with the United States economy, workforce, industrial base, and strategic interests.

Instructions:
1. Research the company using public information.
2. Gather evidence before assigning scores.
3. Be objective and fact-based.
4. Do not use race, ethnicity, religion, or political opinions in scoring.
5. Use only measurable business characteristics.

Scoring Framework:

AMERICAN CONTROL (0-40, subtotal max 40)
- U.S. headquarters (0-10)
- CEO based in U.S. (0-10)
- American founder or founded in U.S. (0-10)
- Majority U.S.-based board (0-10)

AMERICAN ECONOMIC BENEFIT (0-40, subtotal max 40)
- U.S. workforce concentration (0-10)
- U.S. manufacturing footprint (0-10)
- U.S. R&D footprint (0-10)
- U.S. taxes and capital investment (0-10)

STRATEGIC IMPORTANCE (0-20, subtotal max 20)
- Defense and national security relevance (0-5)
- Energy independence relevance (0-5)
- Semiconductor or AI leadership relevance (0-5)
- Critical infrastructure, agriculture, healthcare, or industrial leadership relevance (0-5)

PENALTIES (stack all that apply; store applied deduction per item as 0, 10, or 20)
- Majority manufacturing in China: -10
- Significant Chinese supply chain dependence: -10
- Foreign government ownership/control: -20
- Less than 25% U.S. workforce: -10
- Significant adversarial-country regulatory exposure: -10

Final score = american_control.subtotal + american_economic_benefit.subtotal + strategic_importance.subtotal - penalties.total, clamped 0-100.

Return JSON only with this exact structure:
{
  "model": "america_first",
  "score": 0,
  "label": "positive | neutral | negative",
  "confidence": 0.0,
  "american_control": {
    "headquarters": 0,
    "ceo_us": 0,
    "founder_us": 0,
    "board_us": 0,
    "subtotal": 0
  },
  "american_economic_benefit": {
    "workforce": 0,
    "manufacturing": 0,
    "rd": 0,
    "taxes_capex": 0,
    "subtotal": 0
  },
  "strategic_importance": {
    "defense": 0,
    "energy": 0,
    "semiconductors_ai": 0,
    "critical_infrastructure": 0,
    "subtotal": 0
  },
  "penalties": {
    "china_manufacturing": 0,
    "china_supply_chain": 0,
    "foreign_gov_control": 0,
    "low_us_workforce": 0,
    "adversarial_regulatory": 0,
    "total": 0
  },
  "commentary": ""
}

Rules:
- score >= 70 -> positive; 40-69 -> neutral; < 40 -> negative
- confidence between 0.0 and 1.0
- penalties.total must equal sum of applied penalty amounts
- Return JSON only.
$prompt$;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'seed_america_first_score_con190: no organizations; skip';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id
  FROM public.signal_categories
  WHERE organization_id = v_org_id AND name = 'MACRO_REGIME'
  LIMIT 1;

  IF v_cat_id IS NULL THEN
    SELECT id INTO v_cat_id
    FROM public.signal_categories
    WHERE organization_id = v_org_id
    ORDER BY name
    LIMIT 1;
  END IF;

  INSERT INTO public.factors (
    organization_id,
    key,
    name,
    value_type,
    description,
    data_grain,
    period_supported,
    statement_type,
    factor_origin,
    factor_visibility_mode
  )
  SELECT
    v_org_id,
    'america_first_score',
    'America First Score',
    'number',
    'CON-190: LLM rubric score for U.S. economic alignment, control, strategic importance, minus penalties.',
    'snapshot',
    'none',
    'market_data',
    'organization',
    'public'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.factors f
    WHERE f.organization_id = v_org_id
      AND f.key = 'america_first_score'
  );

  SELECT id INTO v_formula_id
  FROM public.formulas
  WHERE organization_id = v_org_id
    AND key = 'america_first_score'
  LIMIT 1;

  IF v_formula_id IS NULL THEN
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
      is_active,
      marketing_slug,
      marketing_settings,
      formula_origin,
      equation_visibility_mode
    )
    VALUES (
      v_org_id,
      v_cat_id,
      'america_first_score',
      'America First Score',
      'number',
      jsonb_build_object('type', 'llm_rubric', 'model', 'america_first'),
      'American Control + Economic Benefit + Strategic Importance − Penalties (0–100)',
      'CON-190: LLM-scored alignment with U.S. economy, workforce, industrial base, and strategic interests.',
      'public',
      'MASTER_MODEL',
      'llm',
      1,
      true,
      'america-first-score',
      jsonb_build_object(
        'cta_key', 'Create Account',
        'public_ticker_limit', 5,
        'default_sort', 'score_desc',
        'category', 'Macro & Policy'
      ),
      'organization',
      'public'
    )
    RETURNING id INTO v_formula_id;
  ELSE
    UPDATE public.formulas
    SET
      name = 'America First Score',
      output_type = 'number',
      definition = jsonb_build_object('type', 'llm_rubric', 'model', 'america_first'),
      display_formula = 'American Control + Economic Benefit + Strategic Importance − Penalties (0–100)',
      description = 'CON-190: LLM-scored alignment with U.S. economy, workforce, industrial base, and strategic interests.',
      visibility = 'public',
      marketing_slug = 'america-first-score',
      marketing_settings = jsonb_build_object(
        'cta_key', 'Create Account',
        'public_ticker_limit', 5,
        'default_sort', 'score_desc',
        'category', 'Macro & Policy'
      ),
      equation_visibility_mode = 'public',
      updated_at = now()
    WHERE id = v_formula_id;
  END IF;

  INSERT INTO public.prompts (organization_id, key, category, name, description)
  VALUES (
    v_org_id,
    'america_first_score',
    'formula',
    'America First Score',
    'LLM prompt for America First Score (CON-190) with rubric sub-scores and penalties.'
  )
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now()
  RETURNING id INTO v_prompt_id;

  IF v_prompt_id IS NULL THEN
    SELECT id INTO v_prompt_id
    FROM public.prompts
    WHERE key = 'america_first_score'
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
    'You are an equity research analyst focused on U.S. economic alignment and strategic domestic benefit.',
    v_user_prompt,
    v_schema,
    'CON-190 seed prompt',
    'gemini-2.0-flash',
    0.2,
    NULL,
    2048
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

CREATE OR REPLACE VIEW public.v_security_america_first_scores AS
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
america_first_factor AS (
  SELECT f.id AS factor_id
  FROM public.factors f
  WHERE f.key = 'america_first_score'
  LIMIT 1
),
latest_america_first AS (
  SELECT
    efv.entity_id,
    efv.value_num                       AS america_first_score,
    efv.value_text                      AS america_first_payload_text,
    efv.updated_at                      AS america_first_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY efv.entity_id
      ORDER BY efv.updated_at DESC NULLS LAST
    ) AS rn
  FROM public.entity_factor_values efv
  JOIN america_first_factor af ON af.factor_id = efv.factor_id
)
SELECT
  a.security_id,
  a.entity_id,
  a.ticker,
  a.security_name,
  l.america_first_score,
  CASE
    WHEN l.america_first_score IS NULL THEN NULL
    WHEN l.america_first_score >= 70    THEN 'positive'
    WHEN l.america_first_score >= 40    THEN 'neutral'
    ELSE 'negative'
  END                                                                         AS america_first_label,
  CASE
    WHEN l.america_first_payload_text IS NOT NULL
    THEN ((l.america_first_payload_text)::jsonb ->> 'confidence')::numeric
    ELSE NULL
  END                                                                         AS america_first_confidence,
  CASE
    WHEN l.america_first_payload_text IS NOT NULL
    THEN COALESCE(
      (l.america_first_payload_text)::jsonb ->> 'commentary',
      (l.america_first_payload_text)::jsonb ->> 'summary'
    )
    ELSE NULL
  END                                                                         AS america_first_commentary,
  l.america_first_updated_at,
  l.america_first_payload_text
FROM active_securities a
LEFT JOIN latest_america_first l
  ON l.entity_id = a.entity_id
 AND l.rn = 1;

INSERT INTO public.data_sync_job_schedules (
  job_key, enabled, frequency, timezone,
  hourly_interval_hours, hourly_start_time, market_days_only,
  daily_time, weekly_day_of_week, weekly_time,
  monthly_day_of_month, monthly_time, run_next_market_day_if_closed
) VALUES
  ('americaFirstScore', true, 'weekly', 'America/New_York', NULL, NULL, false, NULL, 1, '12:30', NULL, NULL, false)
ON CONFLICT (job_key) DO NOTHING;
