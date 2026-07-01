-- SKE-36: Insider Precision Score — formula seed (configurable params; first organization)

DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE NOTICE 'seed_insider_precision_score_ske36: no organizations; skip';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id FROM public.signal_categories
  WHERE organization_id = v_org_id AND name = 'CAPITAL_FLOWS'
  LIMIT 1;

  IF v_cat_id IS NULL THEN
    SELECT id INTO v_cat_id FROM public.signal_categories
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
    'insider_precision_score',
    'Insider Precision Score',
    'number',
    jsonb_build_object(
      'type', 'insider_precision',
      'params', jsonb_build_object(
        'role_weight_ceo', 1.0,
        'role_weight_cfo', 0.9,
        'role_weight_chairman', 0.9,
        'role_weight_president', 0.8,
        'role_weight_director', 0.6,
        'role_weight_ten_percent_owner', 0.7,
        'role_weight_officer', 0.5,
        'recency_weight_0_30_days', 1.0,
        'recency_weight_31_60_days', 0.7,
        'recency_weight_61_90_days', 0.4,
        'signal_lookback_days', 90,
        'buy_cluster_multiplier_1', 1.0,
        'buy_cluster_multiplier_2', 1.2,
        'buy_cluster_multiplier_3_plus', 1.5,
        'sell_cluster_multiplier_1', 1.0,
        'sell_cluster_multiplier_2', 1.1,
        'sell_cluster_multiplier_3_plus', 1.25,
        'score_scaling_factor', 800,
        'minimum_trade_value_threshold_usd', 25000,
        'included_transaction_types', jsonb_build_array('P', 'S'),
        'market_cap_normalization_method', 'market_cap'
      )
    ),
    'ICS: 100×tanh((net_pressure / size) × scale); role/recency/cluster weights; SEC types filter (Formulas.md).',
    'SKE-36: Insider precision from Form 4-style flows — open-market buys/sells, roles, recency, clustering, cap normalization (Formulas.md).',
    'organization',
    'MASTER_MODEL',
    'deterministic',
    1,
    true
  )
  ON CONFLICT (key) DO NOTHING;
END $$;
