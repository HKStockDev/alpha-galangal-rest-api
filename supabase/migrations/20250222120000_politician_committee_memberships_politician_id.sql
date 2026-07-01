BEGIN;

ALTER TABLE public.politician_committee_memberships
  ADD COLUMN IF NOT EXISTS politician_id uuid REFERENCES public.politicians(id) ON DELETE CASCADE;

UPDATE public.politician_committee_memberships pcm
SET politician_id = p.id
FROM public.politicians p
WHERE p.bioguide_id = pcm.bioguide_id
  AND pcm.politician_id IS NULL;

DELETE FROM public.politician_committee_memberships
WHERE politician_id IS NULL;

ALTER TABLE public.politician_committee_memberships
  ALTER COLUMN politician_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS pcm_politician_congress_idx
  ON public.politician_committee_memberships (politician_id, congress);

COMMENT ON COLUMN public.politician_committee_memberships.politician_id IS 'FK to politicians for fast joins and referential integrity; bioguide_id kept for sync/source.';

COMMIT;
