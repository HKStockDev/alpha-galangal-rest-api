BEGIN;

ALTER TABLE public.exposures
  DROP CONSTRAINT IF EXISTS chk_exposures_polarity;

ALTER TABLE public.exposures
  ADD CONSTRAINT chk_exposures_polarity
  CHECK (polarity IS NULL OR polarity IN (-1, 0, 1));

COMMENT ON COLUMN public.exposures.polarity IS
  'Intrinsic sign of the theme for scoring/UX: +1 favorable, -1 unfavorable, 0 explicitly neutral; NULL = not classified (distinct from neutral).';

COMMIT;
