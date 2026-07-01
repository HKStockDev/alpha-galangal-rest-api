BEGIN;

CREATE TABLE IF NOT EXISTS public.data_sync_job_last_runs (
  job_key text PRIMARY KEY,
  finished_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT false,
  summary text NULL,
  run_id text NULL,
  source text NOT NULL DEFAULT 'trigger.dev',
  trigger_status text NULL,
  running boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_sync_job_last_runs_finished_at
  ON public.data_sync_job_last_runs (finished_at DESC);

ALTER TABLE public.data_sync_job_last_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.data_sync_job_last_runs IS
  'Latest completed (or in-progress) data-sync job result per job_key. Written by Trigger.dev tasks and Nest scheduler.';

COMMIT;
