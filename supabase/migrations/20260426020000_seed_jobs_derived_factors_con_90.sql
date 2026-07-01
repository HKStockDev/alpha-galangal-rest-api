BEGIN;

DO $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization found to seed CON-90 jobs factors.';
  END IF;

  -- CON-90 jobs derived formulas
  INSERT INTO public.factors (
    id,
    key,
    name,
    value_type,
    description,
    created_at,
    data_grain,
    period_supported,
    statement_type,
    organization_id
  )
  SELECT
    gen_random_uuid(),
    'jobs_growth_rate_30d',
    'Jobs Growth Rate 30D',
    'number',
    'Open jobs growth over 30 days: (open_jobs_count_today - open_jobs_count_30d_ago) / open_jobs_count_30d_ago.',
    now(),
    'snapshot',
    'none',
    'custom',
    v_org_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.factors WHERE key = 'jobs_growth_rate_30d' AND organization_id = v_org_id
  );

  INSERT INTO public.factors (
    id,
    key,
    name,
    value_type,
    description,
    created_at,
    data_grain,
    period_supported,
    statement_type,
    organization_id
  )
  SELECT
    gen_random_uuid(),
    'jobs_growth_rate_90d',
    'Jobs Growth Rate 90D',
    'number',
    'Open jobs growth over 90 days: (open_jobs_count_today - open_jobs_count_90d_ago) / open_jobs_count_90d_ago.',
    now(),
    'snapshot',
    'none',
    'custom',
    v_org_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.factors WHERE key = 'jobs_growth_rate_90d' AND organization_id = v_org_id
  );

  INSERT INTO public.factors (
    id,
    key,
    name,
    value_type,
    description,
    created_at,
    data_grain,
    period_supported,
    statement_type,
    organization_id
  )
  SELECT
    gen_random_uuid(),
    'workforce_growth_rate_90d',
    'Workforce Growth Rate 90D',
    'number',
    'Employee estimate growth over 90 days: (employee_count_estimate_today - employee_count_estimate_90d_ago) / employee_count_estimate_90d_ago.',
    now(),
    'snapshot',
    'none',
    'custom',
    v_org_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.factors WHERE key = 'workforce_growth_rate_90d' AND organization_id = v_org_id
  );

  INSERT INTO public.factors (
    id,
    key,
    name,
    value_type,
    description,
    created_at,
    data_grain,
    period_supported,
    statement_type,
    organization_id
  )
  SELECT
    gen_random_uuid(),
    'hiring_spike_indicator',
    'Hiring Spike Indicator',
    'number',
    'Hiring spike ratio: open_jobs_count_today / average_open_jobs_count_past_90_days.',
    now(),
    'snapshot',
    'none',
    'custom',
    v_org_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.factors WHERE key = 'hiring_spike_indicator' AND organization_id = v_org_id
  );
END $$;

COMMIT;
