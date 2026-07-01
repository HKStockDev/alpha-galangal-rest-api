-- 20260506150000_factors_add_origin_visibility_lock.sql
-- Migration 1: add factor provenance/visibility governance fields.

BEGIN;

ALTER TABLE public.factors
  ADD COLUMN IF NOT EXISTS factor_origin text,
  ADD COLUMN IF NOT EXISTS factor_visibility_mode text,
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_factor_id uuid REFERENCES public.factors(id) ON DELETE SET NULL;

ALTER TABLE public.factors
  DROP CONSTRAINT IF EXISTS factors_factor_origin_check;
ALTER TABLE public.factors
  ADD CONSTRAINT factors_factor_origin_check
  CHECK (factor_origin IN ('system', 'organization'));

ALTER TABLE public.factors
  DROP CONSTRAINT IF EXISTS factors_factor_visibility_mode_check;
ALTER TABLE public.factors
  ADD CONSTRAINT factors_factor_visibility_mode_check
  CHECK (factor_visibility_mode IN ('hidden', 'organization', 'public'));

-- Safe defaults for existing rows; refine in next backfill migration.
UPDATE public.factors
SET
  factor_origin = COALESCE(factor_origin, 'system'),
  factor_visibility_mode = COALESCE(factor_visibility_mode, 'hidden');

ALTER TABLE public.factors
  ALTER COLUMN factor_origin SET NOT NULL,
  ALTER COLUMN factor_visibility_mode SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_factors_origin_visibility
  ON public.factors (factor_origin, factor_visibility_mode);

CREATE INDEX IF NOT EXISTS idx_factors_org_visibility
  ON public.factors (organization_id, factor_visibility_mode);

COMMENT ON COLUMN public.factors.factor_origin IS
  'Ownership/provenance: system or organization.';
COMMENT ON COLUMN public.factors.factor_visibility_mode IS
  'Visibility policy: hidden, organization, or public.';
COMMENT ON COLUMN public.factors.is_locked IS
  'When true, factor is managed by system and not editable by org users.';
COMMENT ON COLUMN public.factors.source_factor_id IS
  'Optional lineage pointer for cloned/forked factors.';

COMMIT;
