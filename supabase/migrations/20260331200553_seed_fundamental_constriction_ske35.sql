-- SKE-35: Fundamental Constriction Score — factors + formula (first org)

DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'seed_fundamental_constriction_ske35: no organizations; skip';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id FROM public.signal_categories
  WHERE organization_id = v_org_id AND name = 'BUSINESS_QUALITY'
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
    (v_org_id, 'fc_earnings_acceleration_pct', 'FC: Earnings acceleration (pctile 0–100)', 'number',
     'Percentile rank of annual EPS growth acceleration (FMP income-statement-growth).', 'snapshot', 'none', 'financial_ratio'),
    (v_org_id, 'fc_margin_expansion_pct', 'FC: Margin expansion (pctile 0–100)', 'number',
     'Percentile rank of operating margin change vs prior fiscal year (FMP income-statement).', 'snapshot', 'none', 'financial_ratio'),
    (v_org_id, 'fc_roic_improvement_pct', 'FC: ROIC improvement (pctile 0–100)', 'number',
     'Percentile rank of ROIC change vs prior fiscal year (FMP ratios).', 'snapshot', 'none', 'financial_ratio'),
    (v_org_id, 'fc_valuation_compression_pct', 'FC: Valuation compression (pctile 0–100)', 'number',
     'Percentile rank of P/E compression (FMP key-metrics).', 'snapshot', 'none', 'market_data'),
    (v_org_id, 'fc_balance_sheet_strength_pct', 'FC: Balance sheet strength (pctile 0–100)', 'number',
     'Percentile rank of debt/equity reduction vs prior fiscal year (FMP ratios).', 'snapshot', 'none', 'financial_ratio')
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
    'fundamental_constriction_score',
    'Fundamental Constriction Score',
    'number',
    jsonb_build_object(
      'type', 'composite',
      'weights', jsonb_build_object(
        'fc_earnings_acceleration_pct', 0.30,
        'fc_margin_expansion_pct', 0.25,
        'fc_roic_improvement_pct', 0.20,
        'fc_valuation_compression_pct', 0.15,
        'fc_balance_sheet_strength_pct', 0.10
      )
    ),
    '0.30×EA + 0.25×ME + 0.20×ROIC + 0.15×VC + 0.10×BS',
    'SKE-35: weighted percentile blend (earnings acceleration, margin expansion, ROIC improvement, valuation compression, balance sheet). FMP-backed.',
    'organization',
    'MASTER_MODEL',
    'deterministic',
    1,
    true
  )
  ON CONFLICT (key) DO NOTHING;
END $$;

