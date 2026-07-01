-- 002_create_politician_committee_memberships.sql
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.committee_role AS ENUM ('chair', 'ranking_member', 'vice_chair', 'member', 'ex_officio', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.politician_committee_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  bioguide_id text NOT NULL,

  committee_system_code text NOT NULL,

  congress int NOT NULL CHECK (congress >= 1 AND congress <= 999),

  role public.committee_role NOT NULL DEFAULT 'member',

  member_rank int NULL CHECK (member_rank IS NULL OR member_rank >= 1),

  source text NOT NULL DEFAULT 'congress_gov',
  source_payload jsonb NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pcm_unique_membership UNIQUE (bioguide_id, committee_system_code, congress),

  CONSTRAINT pcm_committee_fk
    FOREIGN KEY (committee_system_code)
    REFERENCES public.committees(system_code)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS pcm_bioguide_congress_idx
  ON public.politician_committee_memberships (bioguide_id, congress);

CREATE INDEX IF NOT EXISTS pcm_committee_congress_idx
  ON public.politician_committee_memberships (committee_system_code, congress);

COMMIT;
