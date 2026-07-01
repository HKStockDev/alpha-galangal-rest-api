-- SKE-41: Net exposure score — factors + formula seed (first organization)

DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'seed_net_exposure_score_ske41: no organizations; skip';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id FROM public.signal_categories
  WHERE organization_id = v_org_id AND name = 'MACRO_REGIME'
  LIMIT 1;

  IF v_cat_id IS NULL THEN
    SELECT id INTO v_cat_id FROM public.signal_categories
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
    statement_type
  )
  VALUES
    (v_org_id, 'ex_tailwind_score', 'Exposure: Tailwind score', 'number',
     'Sum(direction_weight * strength * confidence) for exposures with polarity = +1.', 'snapshot', 'none', 'market_data'),
    (v_org_id, 'ex_headwind_score', 'Exposure: Headwind score', 'number',
     'Sum(direction_weight * strength * confidence) for exposures with polarity = -1 (stored as positive magnitude).', 'snapshot', 'none', 'market_data'),
    (v_org_id, 'ex_net_exposure_score', 'Exposure: Net exposure score', 'number',
     'Primary signal: sum(polarity * direction_weight * strength * confidence).', 'snapshot', 'none', 'market_data')
  ON CONFLICT (key) DO NOTHING;

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
    'net_exposure_score',
    'Net Exposure Score',
    'number',
    jsonb_build_object(
      'type', 'deterministic',
      'equation', 'sum(polarity * direction_weight * strength * confidence)',
      'direction_weights', jsonb_build_object(
        'beneficiary', 1.0,
        'supplier', 0.7,
        'customer', 0.5,
        'dependent', 0.5
      ),
      'factors', jsonb_build_array(
        'ex_tailwind_score',
        'ex_headwind_score',
        'ex_net_exposure_score'
      )
    ),
    'net = Σ(polarity×direction_weight×strength×confidence); tailwind = Σ(term|polarity=+1); headwind = Σ(term|polarity=-1)',
    'SKE-41: Exposure signal from security_exposures and exposures.polarity (Formulas.md Net Exposure Score).',
    'organization',
    'MASTER_MODEL',
    'deterministic',
    1,
    true
  )
  ON CONFLICT (key) DO NOTHING;
END $$;
