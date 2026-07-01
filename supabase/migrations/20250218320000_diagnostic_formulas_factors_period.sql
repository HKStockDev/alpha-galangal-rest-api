-- Diagnostic: formulas with missing factor keys, snapshot rows with bad period_key, count of period-specific factors
DO $$
DECLARE
  missing_factor_count int;
  bad_period_count int;
  period_specific_count bigint;
  r record;
BEGIN
  SELECT COUNT(*)::int INTO missing_factor_count
  FROM public.formulas fo
  CROSS JOIN LATERAL jsonb_array_elements(fo.definition->'terms') term
  LEFT JOIN public.factors f ON f.key = (term->>'f')
  WHERE fo.definition ? 'terms'
    AND f.id IS NULL;

  RAISE NOTICE 'A) Formulas referencing missing factor keys: % rows', missing_factor_count;
  FOR r IN
    SELECT fo.id AS formula_id, fo.key AS formula_key, (term->>'f') AS missing_factor_key
    FROM public.formulas fo
    CROSS JOIN LATERAL jsonb_array_elements(fo.definition->'terms') term
    LEFT JOIN public.factors f ON f.key = (term->>'f')
    WHERE fo.definition ? 'terms' AND f.id IS NULL
    LIMIT 20
  LOOP
    RAISE NOTICE '  formula_id=%, formula_key=%, missing_factor_key=%', r.formula_id, r.formula_key, r.missing_factor_key;
  END LOOP;
  IF missing_factor_count > 20 THEN
    RAISE NOTICE '  ... and % more', missing_factor_count - 20;
  END IF;

  SELECT COUNT(*)::int INTO bad_period_count
  FROM public.entity_factor_values
  WHERE period_key IS NULL OR period_key = '';

  RAISE NOTICE 'B) entity_factor_values with NULL or empty period_key: % rows', bad_period_count;

  SELECT COUNT(*) INTO period_specific_count
  FROM public.factors
  WHERE key ~ '_\d+_yr' OR key ~ '_\d+_year';

  RAISE NOTICE 'C) Period-specific factors (key ~ _N_yr or _N_year): %', period_specific_count;
END $$;
