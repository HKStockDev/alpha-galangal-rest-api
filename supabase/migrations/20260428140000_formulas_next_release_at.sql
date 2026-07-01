-- Optional scheduled next marketing release (hub / formula page display).

BEGIN;

ALTER TABLE public.formulas
  ADD COLUMN IF NOT EXISTS next_release_at timestamptz NULL;

COMMENT ON COLUMN public.formulas.next_release_at IS
  'Optional scheduled date/time for the next marketing release announcement.';

COMMIT;
