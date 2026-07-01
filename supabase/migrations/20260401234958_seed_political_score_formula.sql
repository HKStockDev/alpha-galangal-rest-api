-- Political score — factors + formula (SKE-style composite; scores computed in PoliticalScoreService)

DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'seed_political_score_formula: no organizations; skip';
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
    (v_org_id, 'ps_committee_relevance_pct', 'PS: Committee relevance (0–100)', 'number',
     'Max committee–sector relevance for the trade (Formulas.md).', 'snapshot', 'none', 'market_data'),
    (v_org_id, 'ps_trade_size_pct', 'PS: Trade size (0–100)', 'number',
     'Disclosed trade value bucket (midpoint of range).', 'snapshot', 'none', 'market_data'),
    (v_org_id, 'ps_recency_pct', 'PS: Recency (0–100)', 'number',
     'Days since trade_date in 180d window.', 'snapshot', 'none', 'market_data'),
    (v_org_id, 'ps_influence_pct', 'PS: Influence (0–100)', 'number',
     'Committee role (chair / ranking / member).', 'snapshot', 'none', 'market_data'),
    (v_org_id, 'ps_cluster_pct', 'PS: Cluster (0–100)', 'number',
     'Unique politicians same security, same side, 90d window.', 'snapshot', 'none', 'market_data')
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
    'political_score',
    'Political Score',
    'number',
    jsonb_build_object(
      'type', 'composite',
      'weights', jsonb_build_object(
        'ps_committee_relevance_pct', 0.35,
        'ps_trade_size_pct', 0.20,
        'ps_recency_pct', 0.20,
        'ps_influence_pct', 0.15,
        'ps_cluster_pct', 0.10
      )
    ),
    '100×(Buy−Sell)/(Buy+Sell+1); TradeScore = 0.35·CR + 0.20·TS + 0.20·R + 0.15·I + 0.10·C',
    'Congressional trade signal from FMP disclosures, committee overlap, and clustering (Formulas.md).',
    'organization',
    'MASTER_MODEL',
    'deterministic',
    1,
    true
  )
  ON CONFLICT (key) DO NOTHING;
END $$;
