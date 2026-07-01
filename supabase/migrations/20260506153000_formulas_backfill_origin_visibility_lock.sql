-- 20260506153000_formulas_backfill_origin_visibility_lock.sql
-- Migration 4: backfill formula provenance/disclosure defaults.

BEGIN;

-- Ensure columns exist (safe if already created by previous migration).
ALTER TABLE public.formulas
  ADD COLUMN IF NOT EXISTS formula_origin text,
  ADD COLUMN IF NOT EXISTS equation_visibility_mode text,
  ADD COLUMN IF NOT EXISTS source_formula_id uuid REFERENCES public.formulas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

ALTER TABLE public.formulas
  DROP CONSTRAINT IF EXISTS formulas_formula_origin_check;
ALTER TABLE public.formulas
  ADD CONSTRAINT formulas_formula_origin_check
  CHECK (formula_origin IN ('system', 'organization'));

ALTER TABLE public.formulas
  DROP CONSTRAINT IF EXISTS formulas_equation_visibility_mode_check;
ALTER TABLE public.formulas
  ADD CONSTRAINT formulas_equation_visibility_mode_check
  CHECK (equation_visibility_mode IN ('hidden', 'owner_only', 'public'));

-- Default existing rows to system + hidden + locked (safer baseline).
UPDATE public.formulas
SET
  formula_origin = COALESCE(formula_origin, 'system'),
  equation_visibility_mode = COALESCE(equation_visibility_mode, 'hidden'),
  is_locked = COALESCE(is_locked, true);

-- Heuristic: org-created rows (has org + creator) become org-owned by default.
UPDATE public.formulas
SET
  formula_origin = 'organization',
  equation_visibility_mode = CASE
    WHEN equation_visibility_mode = 'hidden' THEN 'owner_only'
    ELSE equation_visibility_mode
  END,
  is_locked = false
WHERE organization_id IS NOT NULL
  AND created_by_user_id IS NOT NULL
  AND formula_origin = 'system';

ALTER TABLE public.formulas
  ALTER COLUMN formula_origin SET NOT NULL,
  ALTER COLUMN equation_visibility_mode SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_formulas_origin_visibility
  ON public.formulas (formula_origin, equation_visibility_mode);

COMMIT;
