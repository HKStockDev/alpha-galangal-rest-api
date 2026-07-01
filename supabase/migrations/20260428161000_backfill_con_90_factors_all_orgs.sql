BEGIN;

WITH factor_templates AS (
  SELECT *
  FROM (
    VALUES
      (
        'jobs_growth_rate_30d',
        'Jobs Growth Rate 30D',
        'Open jobs growth over 30 days: (open_jobs_count_today - open_jobs_count_30d_ago) / open_jobs_count_30d_ago.'
      ),
      (
        'jobs_growth_rate_90d',
        'Jobs Growth Rate 90D',
        'Open jobs growth over 90 days: (open_jobs_count_today - open_jobs_count_90d_ago) / open_jobs_count_90d_ago.'
      ),
      (
        'workforce_growth_rate_90d',
        'Workforce Growth Rate 90D',
        'Employee estimate growth over 90 days: (employee_count_estimate_today - employee_count_estimate_90d_ago) / employee_count_estimate_90d_ago.'
      ),
      (
        'hiring_spike_indicator',
        'Hiring Spike Indicator',
        'Hiring spike ratio: open_jobs_count_today / average_open_jobs_count_past_90_days.'
      )
  ) AS t(key, name, description)
)
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
  ft.key,
  ft.name,
  'number',
  ft.description,
  now(),
  'snapshot',
  'none',
  'custom',
  o.id
FROM public.organizations o
CROSS JOIN factor_templates ft
WHERE NOT EXISTS (
  SELECT 1
  FROM public.factors f
  WHERE f.organization_id = o.id
    AND f.key = ft.key
);

COMMIT;
