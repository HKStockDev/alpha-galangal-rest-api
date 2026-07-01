-- Platform admin: internal staff with cross-tenant RLS access.
-- Protects is_platform_admin from self-escalation via normal authenticated writes.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Column
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_platform_admin IS
  'When true, user is internal platform staff; RLS policies grant cross-tenant access for admin operations.';

-- ---------------------------------------------------------------------------
-- 2) Prevent self-escalation / forged inserts (service role: auth.uid() IS NULL)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.profiles_enforce_platform_admin_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_is_admin boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_platform_admin, false) = true THEN
      IF auth.uid() IS NOT NULL THEN
        SELECT COALESCE(p.is_platform_admin, false)
        INTO v_actor_is_admin
        FROM public.profiles p
        WHERE p.id = auth.uid();

        IF NOT COALESCE(v_actor_is_admin, false) THEN
          RAISE EXCEPTION 'Cannot set is_platform_admin without platform admin privileges';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
      IF auth.uid() IS NOT NULL THEN
        SELECT COALESCE(p.is_platform_admin, false)
        INTO v_actor_is_admin
        FROM public.profiles p
        WHERE p.id = auth.uid();

        IF NOT COALESCE(v_actor_is_admin, false) THEN
          RAISE EXCEPTION 'Cannot modify is_platform_admin without platform admin privileges';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_enforce_platform_admin ON public.profiles;
CREATE TRIGGER trg_profiles_enforce_platform_admin
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_enforce_platform_admin_column();

REVOKE ALL ON FUNCTION public.profiles_enforce_platform_admin_column() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) RLS helper (SECURITY DEFINER: inner read must bypass RLS or policies that
--    call is_platform_admin() recurse infinitely on profiles)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) RLS: platform admin policies (additive OR with existing permissive policies)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_select_platform_admin ON public.profiles;
CREATE POLICY profiles_select_platform_admin
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS profiles_update_platform_admin ON public.profiles;
CREATE POLICY profiles_update_platform_admin
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS organizations_select_platform_admin ON public.organizations;
CREATE POLICY organizations_select_platform_admin
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS organizations_insert_platform_admin ON public.organizations;
CREATE POLICY organizations_insert_platform_admin
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS organizations_update_platform_admin ON public.organizations;
CREATE POLICY organizations_update_platform_admin
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS organizations_delete_platform_admin ON public.organizations;
CREATE POLICY organizations_delete_platform_admin
  ON public.organizations
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- organization_memberships
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS organization_memberships_select_platform_admin ON public.organization_memberships;
CREATE POLICY organization_memberships_select_platform_admin
  ON public.organization_memberships
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS organization_memberships_insert_platform_admin ON public.organization_memberships;
CREATE POLICY organization_memberships_insert_platform_admin
  ON public.organization_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS organization_memberships_update_platform_admin ON public.organization_memberships;
CREATE POLICY organization_memberships_update_platform_admin
  ON public.organization_memberships
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS organization_memberships_delete_platform_admin ON public.organization_memberships;
CREATE POLICY organization_memberships_delete_platform_admin
  ON public.organization_memberships
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- organization_invitations
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS organization_invitations_select_platform_admin ON public.organization_invitations;
CREATE POLICY organization_invitations_select_platform_admin
  ON public.organization_invitations
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS organization_invitations_insert_platform_admin ON public.organization_invitations;
CREATE POLICY organization_invitations_insert_platform_admin
  ON public.organization_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS organization_invitations_update_platform_admin ON public.organization_invitations;
CREATE POLICY organization_invitations_update_platform_admin
  ON public.organization_invitations
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS organization_invitations_delete_platform_admin ON public.organization_invitations;
CREATE POLICY organization_invitations_delete_platform_admin
  ON public.organization_invitations
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Tenant content: full access for platform formulas / prompts / signals admin
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS factors_select_platform_admin ON public.factors;
CREATE POLICY factors_select_platform_admin
  ON public.factors
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS factors_insert_platform_admin ON public.factors;
CREATE POLICY factors_insert_platform_admin
  ON public.factors
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS factors_update_platform_admin ON public.factors;
CREATE POLICY factors_update_platform_admin
  ON public.factors
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS factors_delete_platform_admin ON public.factors;
CREATE POLICY factors_delete_platform_admin
  ON public.factors
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS formulas_select_platform_admin ON public.formulas;
CREATE POLICY formulas_select_platform_admin
  ON public.formulas
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS formulas_insert_platform_admin ON public.formulas;
CREATE POLICY formulas_insert_platform_admin
  ON public.formulas
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS formulas_update_platform_admin ON public.formulas;
CREATE POLICY formulas_update_platform_admin
  ON public.formulas
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS formulas_delete_platform_admin ON public.formulas;
CREATE POLICY formulas_delete_platform_admin
  ON public.formulas
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS prompts_select_platform_admin ON public.prompts;
CREATE POLICY prompts_select_platform_admin
  ON public.prompts
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS prompts_insert_platform_admin ON public.prompts;
CREATE POLICY prompts_insert_platform_admin
  ON public.prompts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS prompts_update_platform_admin ON public.prompts;
CREATE POLICY prompts_update_platform_admin
  ON public.prompts
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS prompts_delete_platform_admin ON public.prompts;
CREATE POLICY prompts_delete_platform_admin
  ON public.prompts
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS prompt_versions_select_platform_admin ON public.prompt_versions;
CREATE POLICY prompt_versions_select_platform_admin
  ON public.prompt_versions
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS prompt_versions_insert_platform_admin ON public.prompt_versions;
CREATE POLICY prompt_versions_insert_platform_admin
  ON public.prompt_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS prompt_versions_update_platform_admin ON public.prompt_versions;
CREATE POLICY prompt_versions_update_platform_admin
  ON public.prompt_versions
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS prompt_versions_delete_platform_admin ON public.prompt_versions;
CREATE POLICY prompt_versions_delete_platform_admin
  ON public.prompt_versions
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS tags_select_platform_admin ON public.tags;
CREATE POLICY tags_select_platform_admin
  ON public.tags
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS tags_insert_platform_admin ON public.tags;
CREATE POLICY tags_insert_platform_admin
  ON public.tags
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS tags_update_platform_admin ON public.tags;
CREATE POLICY tags_update_platform_admin
  ON public.tags
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS tags_delete_platform_admin ON public.tags;
CREATE POLICY tags_delete_platform_admin
  ON public.tags
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS signal_categories_select_platform_admin ON public.signal_categories;
CREATE POLICY signal_categories_select_platform_admin
  ON public.signal_categories
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS signal_categories_insert_platform_admin ON public.signal_categories;
CREATE POLICY signal_categories_insert_platform_admin
  ON public.signal_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS signal_categories_update_platform_admin ON public.signal_categories;
CREATE POLICY signal_categories_update_platform_admin
  ON public.signal_categories
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS signal_categories_delete_platform_admin ON public.signal_categories;
CREATE POLICY signal_categories_delete_platform_admin
  ON public.signal_categories
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Support: read-only across org LLM + watchlists
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS organization_llm_conversations_select_platform_admin ON public.organization_llm_conversations;
CREATE POLICY organization_llm_conversations_select_platform_admin
  ON public.organization_llm_conversations
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS organization_llm_messages_select_platform_admin ON public.organization_llm_messages;
CREATE POLICY organization_llm_messages_select_platform_admin
  ON public.organization_llm_messages
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS organization_watchlists_select_platform_admin ON public.organization_watchlists;
CREATE POLICY organization_watchlists_select_platform_admin
  ON public.organization_watchlists
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS organization_watchlist_securities_select_platform_admin ON public.organization_watchlist_securities;
CREATE POLICY organization_watchlist_securities_select_platform_admin
  ON public.organization_watchlist_securities
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

COMMIT;
