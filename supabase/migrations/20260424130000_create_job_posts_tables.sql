BEGIN;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.job_post_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'apify_indeed',
  actor_id text NOT NULL,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  fetched_count integer NOT NULL DEFAULT 0,
  persisted_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'apify_indeed',
  source_job_id text NOT NULL,
  company_name text NOT NULL,
  search_company_name text NOT NULL,
  title text,
  location_text text,
  country_code text,
  salary_text text,
  posted_at timestamptz,
  indeed_url text,
  external_url text,
  is_remote boolean,
  is_expired boolean,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_sync_run_id uuid NULL REFERENCES public.job_post_sync_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_posts_provider_source_job_id_uq UNIQUE (provider, source_job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_posts_company_name
  ON public.job_posts (company_name);

CREATE INDEX IF NOT EXISTS idx_job_posts_search_company_name
  ON public.job_posts (search_company_name);

CREATE INDEX IF NOT EXISTS idx_job_posts_posted_at_desc
  ON public.job_posts (posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_posts_last_seen_at_desc
  ON public.job_posts (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_posts_remote
  ON public.job_posts (is_remote);

CREATE INDEX IF NOT EXISTS idx_job_posts_expired
  ON public.job_posts (is_expired);

DROP TRIGGER IF EXISTS trg_job_posts_set_updated_at ON public.job_posts;
CREATE TRIGGER trg_job_posts_set_updated_at
  BEFORE UPDATE ON public.job_posts
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.job_post_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_posts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.job_post_sync_runs IS
'Audit log for each Apify Indeed sync execution (query, fetched count, persisted count).';

COMMENT ON TABLE public.job_posts IS
'Normalized raw job postings fetched from Indeed via Apify for CON-45 job-post ingestion.';

COMMIT;
