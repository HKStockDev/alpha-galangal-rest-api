-- Align marketing_settings.default_sort with app convention (highest score first).

BEGIN;

UPDATE public.formulas
SET marketing_settings = marketing_settings || jsonb_build_object('default_sort', 'score_desc');

COMMIT;
