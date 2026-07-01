BEGIN;

-- CON-88: normalized snapshots used to populate jobs-related factors.
CREATE TABLE IF NOT EXISTS public.entity_jobs_metrics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  security_id uuid NULL REFERENCES public.securities(id) ON DELETE SET NULL,
  as_of_date date NOT NULL DEFAULT current_date,
  open_jobs_count numeric NULL,
  employee_count_estimate numeric NULL,
  jobs_per_100_employees numeric NULL,
  open_jobs_source text NULL,
  employee_count_source text NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_jobs_metrics_snapshots_entity_asof_uq UNIQUE (entity_id, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_entity_jobs_metrics_snapshots_as_of_date
  ON public.entity_jobs_metrics_snapshots(as_of_date DESC);

CREATE INDEX IF NOT EXISTS idx_entity_jobs_metrics_snapshots_security_id
  ON public.entity_jobs_metrics_snapshots(security_id)
  WHERE security_id IS NOT NULL;

COMMENT ON TABLE public.entity_jobs_metrics_snapshots IS
'CON-88: source snapshots for jobs metrics (open jobs, employee estimate, hiring intensity) per entity/as-of date.';

COMMENT ON COLUMN public.entity_jobs_metrics_snapshots.open_jobs_source IS
'Selected source for open_jobs_count, e.g. linkedin_riceman.total_job_openings or job_posts.company_name_count.';

COMMENT ON COLUMN public.entity_jobs_metrics_snapshots.employee_count_source IS
'Selected source for employee_count_estimate, e.g. linkedin_headcount_cache or securities.total_employees.';

ALTER TABLE public.entity_jobs_metrics_snapshots ENABLE ROW LEVEL SECURITY;

COMMIT;
