-- 20260506112000_formulas_origin_and_visibility_policy.sql
-- Adds provenance + equation visibility controls for formulas.

BEGIN;

-- 1) Add columns (idempotent)
ALTER TABLE public.formulas
  ADD COLUMN IF NOT EXISTS formula_origin text,
  ADD COLUMN IF NOT EXISTS equation_visibility_mode text,
  ADD COLUMN IF NOT EXISTS source_formula_id uuid REFERENCES public.formulas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

-- 2) Add constraints (drop/recreate so reruns are safe)
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

-- 3) Backfill existing rows with safe defaults
-- Treat existing formulas as system-owned unless explicitly changed later.
UPDATE public.formulas
SET
  formula_origin = COALESCE(formula_origin, 'system'),
  equation_visibility_mode = COALESCE(equation_visibility_mode, 'hidden');

-- 4) Enforce NOT NULL after backfill
ALTER TABLE public.formulas
  ALTER COLUMN formula_origin SET NOT NULL,
  ALTER COLUMN equation_visibility_mode SET NOT NULL;

-- 5) Helpful index for policy lookups
CREATE INDEX IF NOT EXISTS idx_formulas_origin_visibility
  ON public.formulas (formula_origin, equation_visibility_mode);

-- 6) Documentation
COMMENT ON COLUMN public.formulas.formula_origin IS
  'Who created/owns the formula definition policy-wise: system or organization.';

COMMENT ON COLUMN public.formulas.equation_visibility_mode IS
  'Equation disclosure policy: hidden (never exact), owner_only, or public.';

COMMENT ON COLUMN public.formulas.source_formula_id IS
  'Optional lineage pointer to source formula when cloned/forked.';

COMMENT ON COLUMN public.formulas.is_locked IS
  'When true, formula definition is managed by system and not editable by org users.';

COMMIT;
