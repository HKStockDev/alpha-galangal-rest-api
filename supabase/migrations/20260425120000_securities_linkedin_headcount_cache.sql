-- LinkedIn company URL + cached Apify actor results (logical_scrapers + riceman) for headcount admin UI.

ALTER TABLE public.securities
  ADD COLUMN IF NOT EXISTS linkedin_company_url text,
  ADD COLUMN IF NOT EXISTS linkedin_headcount_cache jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.securities.linkedin_company_url IS
  'Public LinkedIn company page URL (https://www.linkedin.com/company/...) for Apify headcount scrapers.';

COMMENT ON COLUMN public.securities.linkedin_headcount_cache IS
  'Last Apify run results: logical_scraper (numberOfEmployees) and riceman (employee_count, optional insights).';

CREATE INDEX IF NOT EXISTS securities_linkedin_company_url_set_idx
  ON public.securities (id)
  WHERE linkedin_company_url IS NOT NULL AND btrim(linkedin_company_url) <> '';
