-- 20260506152000_factors_key_uniqueness_org_and_system.sql
-- Migration 3: replace global unique(key) with scoped uniqueness.

BEGIN;

-- Drop historical global unique constraints/indexes if present.
ALTER TABLE public.factors
  DROP CONSTRAINT IF EXISTS factors_key_key,
  DROP CONSTRAINT IF EXISTS factors_key_unique;

DROP INDEX IF EXISTS public.uq_factors_key;
DROP INDEX IF EXISTS public.factors_key_key;
DROP INDEX IF EXISTS public.idx_factors_key;

-- Organization factors: key unique within organization.
CREATE UNIQUE INDEX IF NOT EXISTS uq_factors_org_key_for_org_origin
  ON public.factors (organization_id, key)
  WHERE factor_origin = 'organization';

-- System factors: key globally unique among system origin.
CREATE UNIQUE INDEX IF NOT EXISTS uq_factors_key_for_system_origin
  ON public.factors (key)
  WHERE factor_origin = 'system';

COMMIT;
