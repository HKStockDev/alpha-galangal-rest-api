BEGIN;

ALTER TABLE public.politicians
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS suffix text,
  ADD COLUMN IF NOT EXISTS nickname text,
  ADD COLUMN IF NOT EXISTS name_full text,
  ADD COLUMN IF NOT EXISTS name_last_first text,
  ADD COLUMN IF NOT EXISTS current_party text,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS current_district text,
  ADD COLUMN IF NOT EXISTS official_website_url text,
  ADD COLUMN IF NOT EXISTS updated_at_congress_gov timestamptz,
  ADD COLUMN IF NOT EXISTS birth_year integer,
  ADD COLUMN IF NOT EXISTS death_year integer,
  ADD COLUMN IF NOT EXISTS honorific_name text,
  ADD COLUMN IF NOT EXISTS portrait_url text,
  ADD COLUMN IF NOT EXISTS portrait_source text,
  ADD COLUMN IF NOT EXISTS contact_address text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'congress_gov';

UPDATE public.politicians SET name_full = name WHERE name_full IS NULL AND name IS NOT NULL;
UPDATE public.politicians SET current_party = party WHERE current_party IS NULL AND party IS NOT NULL;
UPDATE public.politicians SET current_state = state WHERE current_state IS NULL AND state IS NOT NULL;
UPDATE public.politicians SET source = 'congress_gov' WHERE source IS NULL;

ALTER TABLE public.politicians
  RENAME COLUMN is_current TO is_current_member;

ALTER TABLE public.politicians
  DROP CONSTRAINT IF EXISTS politicians_name_not_blank;

ALTER TABLE public.politicians
  ADD CONSTRAINT politicians_name_full_not_blank
  CHECK (name_full IS NULL OR btrim(name_full) <> '');

ALTER TABLE public.politicians
  DROP COLUMN IF EXISTS party,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS role,
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS external_id;

DROP INDEX IF EXISTS public.ix_politicians_is_current;
CREATE INDEX IF NOT EXISTS ix_politicians_is_current_member
  ON public.politicians(is_current_member);

COMMIT;
