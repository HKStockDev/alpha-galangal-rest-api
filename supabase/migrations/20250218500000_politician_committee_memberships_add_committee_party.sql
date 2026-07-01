BEGIN;

ALTER TABLE public.politician_committee_memberships
  ADD COLUMN IF NOT EXISTS committee_party text NULL;

COMMENT ON COLUMN public.politician_committee_memberships.committee_party IS 'Committee side: majority or minority (from committee-membership YAML)';

COMMIT;
