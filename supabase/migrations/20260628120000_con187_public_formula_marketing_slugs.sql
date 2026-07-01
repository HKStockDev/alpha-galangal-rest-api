-- CON-187: curated marketing_slug + public visibility for formula-score-sync formulas

DO $$
DECLARE
  v_org_id uuid;
  v_settings jsonb := jsonb_build_object(
    'cta_key', 'Create Account',
    'public_ticker_limit', 5,
    'default_sort', 'score_desc'
  );
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'con187_public_formula_marketing_slugs: no organizations; skip';
    RETURN;
  END IF;

  UPDATE public.formulas
  SET
    visibility = 'public',
    marketing_slug = v.slug,
    marketing_settings = COALESCE(marketing_settings, '{}'::jsonb) || v_settings,
    equation_visibility_mode = 'public',
    updated_at = now()
  FROM (VALUES
    ('political_score', 'political-score'),
    ('insider_precision_score', 'insider-precision-score'),
    ('net_exposure_score', 'net-exposure-score'),
    ('hedge_fund_quality_score', 'hedge-fund-quality-score'),
    ('fundamental_constriction_score', 'fundamental-constriction-score'),
    ('alpha_galangal_committee_buffett_score', 'buffett-score'),
    ('alpha_galangal_committee_burry_score', 'burry-score'),
    ('america_first_score', 'america-first-score')
  ) AS v(formula_key, slug)
  WHERE public.formulas.organization_id = v_org_id
    AND public.formulas.key = v.formula_key;
END $$;
