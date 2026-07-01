-- 20260506155000_rls_update_factors_formulas_origin_visibility.sql
-- Migration 6: update RLS policies to support system/public + org ownership model.

BEGIN;

-- =========================
-- FACTORS
-- =========================
DROP POLICY IF EXISTS factors_select_member ON public.factors;
CREATE POLICY factors_select_member
ON public.factors
FOR SELECT
TO authenticated
USING (
  -- System public factors visible to all authenticated users.
  (factor_origin = 'system' AND factor_visibility_mode = 'public')
  OR
  -- Organization factors visible to active org members.
  (
    factor_origin = 'organization'
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = factors.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  )
);

DROP POLICY IF EXISTS factors_insert_member ON public.factors;
CREATE POLICY factors_insert_member
ON public.factors
FOR INSERT
TO authenticated
WITH CHECK (
  factor_origin = 'organization'
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = factors.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS factors_update_member ON public.factors;
CREATE POLICY factors_update_member
ON public.factors
FOR UPDATE
TO authenticated
USING (
  factor_origin = 'organization'
  AND is_locked = false
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = factors.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
)
WITH CHECK (
  factor_origin = 'organization'
  AND is_locked = false
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = factors.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS factors_delete_member ON public.factors;
CREATE POLICY factors_delete_member
ON public.factors
FOR DELETE
TO authenticated
USING (
  factor_origin = 'organization'
  AND is_locked = false
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = factors.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

-- =========================
-- FORMULAS
-- =========================
DROP POLICY IF EXISTS formulas_select_member ON public.formulas;
CREATE POLICY formulas_select_member
ON public.formulas
FOR SELECT
TO authenticated
USING (
  -- System formulas with non-hidden disclosure mode can be listed/read.
  (formula_origin = 'system' AND equation_visibility_mode IN ('owner_only', 'public'))
  OR
  -- Organization formulas visible to active org members.
  (
    formula_origin = 'organization'
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.organization_id = formulas.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  )
);

DROP POLICY IF EXISTS formulas_insert_member ON public.formulas;
CREATE POLICY formulas_insert_member
ON public.formulas
FOR INSERT
TO authenticated
WITH CHECK (
  formula_origin = 'organization'
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = formulas.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS formulas_update_member ON public.formulas;
CREATE POLICY formulas_update_member
ON public.formulas
FOR UPDATE
TO authenticated
USING (
  formula_origin = 'organization'
  AND is_locked = false
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = formulas.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
)
WITH CHECK (
  formula_origin = 'organization'
  AND is_locked = false
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = formulas.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

DROP POLICY IF EXISTS formulas_delete_member ON public.formulas;
CREATE POLICY formulas_delete_member
ON public.formulas
FOR DELETE
TO authenticated
USING (
  formula_origin = 'organization'
  AND is_locked = false
  AND EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = formulas.organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

COMMIT;
