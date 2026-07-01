BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS estimated_num_employees integer,
  ADD COLUMN IF NOT EXISTS founded_year integer,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS raw_address text,
  ADD COLUMN IF NOT EXISTS external_provider_id text,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_source text,
  ADD COLUMN IF NOT EXISTS enrichment_raw_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_organizations_domain_lower
  ON public.organizations (lower(domain))
  WHERE domain IS NOT NULL;

COMMENT ON COLUMN public.organizations.legal_name IS 'Registered or vendor-reported company name (e.g. from enrichment).';
COMMENT ON COLUMN public.organizations.domain IS 'Primary email/website domain used for enrichment (no scheme or www).';
COMMENT ON COLUMN public.organizations.website_url IS 'Public company website URL.';
COMMENT ON COLUMN public.organizations.linkedin_url IS 'Company LinkedIn profile URL.';
COMMENT ON COLUMN public.organizations.logo_url IS 'HTTPS URL to company logo image.';
COMMENT ON COLUMN public.organizations.phone IS 'Main corporate phone when available.';
COMMENT ON COLUMN public.organizations.description IS 'Short company description from enrichment.';
COMMENT ON COLUMN public.organizations.industry IS 'Primary industry label.';
COMMENT ON COLUMN public.organizations.estimated_num_employees IS 'Estimated headcount from data provider.';
COMMENT ON COLUMN public.organizations.founded_year IS 'Year founded when known.';
COMMENT ON COLUMN public.organizations.country IS 'HQ country (text).';
COMMENT ON COLUMN public.organizations.region IS 'State or region.';
COMMENT ON COLUMN public.organizations.city IS 'HQ city.';
COMMENT ON COLUMN public.organizations.address_line1 IS 'Street line when available.';
COMMENT ON COLUMN public.organizations.postal_code IS 'Postal or ZIP code.';
COMMENT ON COLUMN public.organizations.raw_address IS 'Unstructured address string from provider.';
COMMENT ON COLUMN public.organizations.external_provider_id IS 'Stable id from enrichment provider (e.g. Apollo organization id).';
COMMENT ON COLUMN public.organizations.enriched_at IS 'When enrichment last succeeded.';
COMMENT ON COLUMN public.organizations.enrichment_source IS 'Provider key, e.g. apollo.';
COMMENT ON COLUMN public.organizations.enrichment_raw_json IS 'Last full provider payload for debugging or re-mapping.';

COMMIT;
