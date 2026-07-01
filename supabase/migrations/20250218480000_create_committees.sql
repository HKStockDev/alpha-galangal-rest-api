-- 001_create_committees.sql
BEGIN;

DO $$ BEGIN
  CREATE TYPE public.committee_type AS ENUM (
    'Standing',
    'Select',
    'Special',
    'Joint',
    'Subcommittee',
    'Task Force',
    'Commission or Caucus',
    'Other'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE public.committee_chamber AS ENUM ('house', 'senate', 'joint');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.committees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  system_code text NOT NULL,

  name text NOT NULL,

  chamber public.committee_chamber NOT NULL,

  committee_type public.committee_type NOT NULL,

  is_active boolean NOT NULL DEFAULT true,
  update_date timestamptz NULL,

  is_subcommittee boolean
    GENERATED ALWAYS AS (right(system_code, 2) <> '00') STORED,

  parent_system_code text
    GENERATED ALWAYS AS (
      CASE
        WHEN right(system_code, 2) <> '00' THEN left(system_code, length(system_code) - 2) || '00'
        ELSE NULL
      END
    ) STORED,

  source text NOT NULL DEFAULT 'congress_gov',
  source_payload jsonb NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT committees_system_code_uk UNIQUE (system_code),

  CONSTRAINT committees_system_code_format_chk
    CHECK (
      system_code = lower(system_code)
      AND system_code ~ '^(hs|ss|js)[a-z0-9]{2,10}[0-9]{2}$'
    ),

  CONSTRAINT committees_type_matches_code_chk
    CHECK (
      (right(system_code, 2) = '00' AND committee_type <> 'Subcommittee')
      OR
      (right(system_code, 2) <> '00' AND committee_type = 'Subcommittee')
    )
);

CREATE INDEX IF NOT EXISTS committees_chamber_idx ON public.committees (chamber);
CREATE INDEX IF NOT EXISTS committees_type_idx ON public.committees (committee_type);
CREATE INDEX IF NOT EXISTS committees_active_idx ON public.committees (is_active);
CREATE INDEX IF NOT EXISTS committees_system_code_idx ON public.committees (system_code);

COMMIT;
