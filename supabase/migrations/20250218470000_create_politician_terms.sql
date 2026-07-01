BEGIN;

ALTER TABLE public.politicians
  ADD CONSTRAINT uq_politicians_bioguide_id UNIQUE (bioguide_id);

CREATE TABLE IF NOT EXISTS public.politician_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  bioguide_id text NOT NULL REFERENCES public.politicians(bioguide_id) ON DELETE CASCADE,

  congress integer NOT NULL,
  chamber text,
  member_type text,
  state_code text,
  state_name text,
  district text,
  party text,
  party_code text,
  start_year integer NOT NULL,
  end_year integer NOT NULL,

  source text NOT NULL DEFAULT 'congress_gov',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_politician_terms_bioguide_id
  ON public.politician_terms(bioguide_id);

CREATE INDEX IF NOT EXISTS ix_politician_terms_congress
  ON public.politician_terms(congress);

CREATE INDEX IF NOT EXISTS ix_politician_terms_chamber
  ON public.politician_terms(chamber);

COMMIT;
