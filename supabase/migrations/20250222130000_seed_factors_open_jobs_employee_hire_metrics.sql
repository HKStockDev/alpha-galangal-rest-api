BEGIN;

INSERT INTO public.factors (
  id,
  key,
  name,
  value_type,
  description,
  created_at,
  data_grain,
  period_supported,
  statement_type
)
SELECT
  gen_random_uuid(),
  'open_jobs_count',
  'Open Jobs Count',
  'number',
  'Current number of open published job postings from ATS or company careers page.',
  now(),
  'snapshot',
  'none',
  'custom'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.factors
  WHERE key = 'open_jobs_count'
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
  statement_type
)
SELECT
  gen_random_uuid(),
  'employee_count_estimate',
  'Employee Count Estimate',
  'number',
  'Estimated current employee headcount from Apollo, LinkedIn-derived data, or similar vendor sources.',
  now(),
  'snapshot',
  'none',
  'custom'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.factors
  WHERE key = 'employee_count_estimate'
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
  statement_type
)
SELECT
  gen_random_uuid(),
  'jobs_per_100_employees',
  'Jobs Per 100 Employees',
  'number',
  'Hiring intensity metric calculated as open jobs divided by employee count estimate multiplied by 100.',
  now(),
  'snapshot',
  'none',
  'custom'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.factors
  WHERE key = 'jobs_per_100_employees'
);

COMMIT;
