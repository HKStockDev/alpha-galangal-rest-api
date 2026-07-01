-- 20260506161000_factor_policy_query_helpers.sql
-- Helper indexes for fast policy-aware factor lookups in API/chat flows.

BEGIN;

-- Common filter path:
-- (factor_origin='system' AND factor_visibility_mode='public')
-- OR (factor_origin='organization' AND organization_id=:orgId)
CREATE INDEX IF NOT EXISTS idx_factors_policy_system_public
  ON public.factors (factor_origin, factor_visibility_mode, key)
  WHERE factor_origin = 'system' AND factor_visibility_mode = 'public';

CREATE INDEX IF NOT EXISTS idx_factors_policy_org_visible
  ON public.factors (organization_id, factor_origin, factor_visibility_mode, key)
  WHERE factor_origin = 'organization';

-- Useful for dependency validation and UI lists by name.
CREATE INDEX IF NOT EXISTS idx_factors_org_name
  ON public.factors (organization_id, name);

CREATE INDEX IF NOT EXISTS idx_factors_system_name
  ON public.factors (name)
  WHERE factor_origin = 'system';

COMMENT ON INDEX public.idx_factors_policy_system_public IS
  'Accelerates reads of globally visible system factors.';
COMMENT ON INDEX public.idx_factors_policy_org_visible IS
  'Accelerates reads of organization-owned factors for an org.';

COMMIT;
