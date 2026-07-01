-- Add name parts, tenure, and provenance columns to insiders (display/analytics; entities stays generic).

ALTER TABLE public.insiders
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS middle_name text,
  ADD COLUMN IF NOT EXISTS name_suffix text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS person_cik text,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS is_current boolean,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_insiders_person_cik ON public.insiders(person_cik) WHERE person_cik IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insiders_is_current ON public.insiders(is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_insiders_source ON public.insiders(source) WHERE source IS NOT NULL;
