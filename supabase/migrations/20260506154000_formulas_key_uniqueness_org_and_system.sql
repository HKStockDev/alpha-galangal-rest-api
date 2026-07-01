-- 20260506154000_formulas_key_uniqueness_org_and_system.sql
-- Migration 5: replace global formula key uniqueness with scoped uniqueness.

BEGIN;

-- Drop historical global unique constraints/indexes if present.
ALTER TABLE public.formulas
  DROP CONSTRAINT IF EXISTS formulas_key_key;

DROP INDEX IF EXISTS public.formulas_key_key;
DROP INDEX IF EXISTS public.uq_formulas_key;
DROP INDEX IF EXISTS public.idx_formulas_key;

-- Organization formulas: key unique within organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_formulas_org_key_for_org_origin
  ON public.formulas (organization_id, key)
  WHERE formula_origin = 'organization';

-- System formulas: key globally unique among system origin.
CREATE UNIQUE INDEX IF NOT EXISTS uq_formulas_key_for_system_origin
  ON public.formulas (key)
  WHERE formula_origin = 'system';

COMMIT;
