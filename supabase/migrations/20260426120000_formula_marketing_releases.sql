-- Marketing formula pages: extend formulas + snapshot releases with ranked tickers (entities).
-- Idempotent where safe (IF NOT EXISTS / DROP IF EXISTS).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) formulas: marketing fields + public visibility
-- ---------------------------------------------------------------------------

ALTER TABLE public.formulas
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS marketing_slug text,
  ADD COLUMN IF NOT EXISTS marketing_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.formulas.hero_image_url IS
  'Optional hero/card image URL for marketing formula pages.';
COMMENT ON COLUMN public.formulas.marketing_slug IS
  'URL segment for the public formula hub (unique per organization).';
COMMENT ON COLUMN public.formulas.marketing_settings IS
  'JSON: optional cta_key, public_ticker_limit, default_sort, etc.';

ALTER TABLE public.formulas
  DROP CONSTRAINT IF EXISTS formulas_visibility_check;

ALTER TABLE public.formulas
  ADD CONSTRAINT formulas_visibility_check
  CHECK (visibility IN ('organization', 'private', 'public'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_formulas_org_marketing_slug
  ON public.formulas (organization_id, lower(btrim(marketing_slug)))
  WHERE marketing_slug IS NOT NULL AND btrim(marketing_slug) <> '';

-- ---------------------------------------------------------------------------
-- 2) formula_marketing_releases (one row per published “drop” / archived page)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.formula_marketing_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_id uuid NOT NULL REFERENCES public.formulas (id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  subtitle text,
  body text,
  hero_image_url text,
  as_of timestamptz NOT NULL,
  published_at timestamptz,
  is_published boolean NOT NULL DEFAULT false,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_formula_marketing_releases_slug_nonempty
    CHECK (btrim(slug) <> ''),
  CONSTRAINT uq_formula_marketing_releases_slug UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_formula_marketing_releases_formula_published
  ON public.formula_marketing_releases (formula_id, published_at DESC NULLS LAST);

COMMENT ON TABLE public.formula_marketing_releases IS
  'Immutable marketing “release” for a formula: slug, copy, publish state, and settings; ticker lines live in formula_marketing_release_rows.';
COMMENT ON COLUMN public.formula_marketing_releases.slug IS
  'Globally unique URL segment for this archived or current release page.';
COMMENT ON COLUMN public.formula_marketing_releases.as_of IS
  'Time the ticker snapshot reflects (factually / for disclosure).';
COMMENT ON COLUMN public.formula_marketing_releases.settings_json IS
  'Per-release overrides: cta_key, public_ticker_limit, default_sort, etc.';

DROP TRIGGER IF EXISTS trg_formula_marketing_releases_set_updated_at
  ON public.formula_marketing_releases;
CREATE TRIGGER trg_formula_marketing_releases_set_updated_at
  BEFORE UPDATE ON public.formula_marketing_releases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) formula_marketing_release_rows (snapshot tickers for a release)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.formula_marketing_release_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL
    REFERENCES public.formula_marketing_releases (id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.entities (id) ON DELETE RESTRICT,
  rank integer,
  score double precision NOT NULL,
  explanation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_formula_marketing_release_rows_release_entity
    UNIQUE (release_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_formula_marketing_release_rows_release_rank
  ON public.formula_marketing_release_rows (release_id, rank);

COMMENT ON TABLE public.formula_marketing_release_rows IS
  'Point-in-time ranked security/entity list captured for a marketing release.';
COMMENT ON COLUMN public.formula_marketing_release_rows.explanation IS
  'Optional copy of score explanation JSON at publish time.';

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.formula_marketing_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formula_marketing_release_rows ENABLE ROW LEVEL SECURITY;

-- formula_marketing_releases: public read (anon + authed) for published + public formula
DROP POLICY IF EXISTS formula_marketing_releases_select_published ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_select_published
  ON public.formula_marketing_releases
  FOR SELECT
  TO anon, authenticated
  USING (
    is_published = true
    AND EXISTS (
      SELECT 1
      FROM public.formulas f
      WHERE f.id = formula_id
        AND f.visibility = 'public'
    )
  );

DROP POLICY IF EXISTS formula_marketing_releases_select_member ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_select_member
  ON public.formula_marketing_releases
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formulas f
      INNER JOIN public.organization_memberships om
        ON om.organization_id = f.organization_id
      WHERE f.id = formula_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS formula_marketing_releases_insert_member ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_insert_member
  ON public.formula_marketing_releases
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.formulas f
      INNER JOIN public.organization_memberships om
        ON om.organization_id = f.organization_id
      WHERE f.id = formula_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS formula_marketing_releases_update_member ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_update_member
  ON public.formula_marketing_releases
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formulas f
      INNER JOIN public.organization_memberships om
        ON om.organization_id = f.organization_id
      WHERE f.id = formula_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.formulas f
      INNER JOIN public.organization_memberships om
        ON om.organization_id = f.organization_id
      WHERE f.id = formula_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS formula_marketing_releases_delete_member ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_delete_member
  ON public.formula_marketing_releases
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formulas f
      INNER JOIN public.organization_memberships om
        ON om.organization_id = f.organization_id
      WHERE f.id = formula_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

-- Platform admin: full access to releases
DROP POLICY IF EXISTS formula_marketing_releases_select_platform_admin ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_select_platform_admin
  ON public.formula_marketing_releases
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS formula_marketing_releases_insert_platform_admin ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_insert_platform_admin
  ON public.formula_marketing_releases
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS formula_marketing_releases_update_platform_admin ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_update_platform_admin
  ON public.formula_marketing_releases
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS formula_marketing_releases_delete_platform_admin ON public.formula_marketing_releases;
CREATE POLICY formula_marketing_releases_delete_platform_admin
  ON public.formula_marketing_releases
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

-- Rows: same visibility as parent release (derive via release + formula)
DROP POLICY IF EXISTS formula_marketing_release_rows_select_published ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_select_published
  ON public.formula_marketing_release_rows
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formula_marketing_releases r
      INNER JOIN public.formulas f ON f.id = r.formula_id
      WHERE r.id = release_id
        AND r.is_published = true
        AND f.visibility = 'public'
    )
  );

DROP POLICY IF EXISTS formula_marketing_release_rows_select_member ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_select_member
  ON public.formula_marketing_release_rows
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formula_marketing_releases r
      INNER JOIN public.formulas f ON f.id = r.formula_id
      INNER JOIN public.organization_memberships om ON om.organization_id = f.organization_id
      WHERE r.id = release_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS formula_marketing_release_rows_insert_member ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_insert_member
  ON public.formula_marketing_release_rows
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.formula_marketing_releases r
      INNER JOIN public.formulas f ON f.id = r.formula_id
      INNER JOIN public.organization_memberships om ON om.organization_id = f.organization_id
      WHERE r.id = release_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS formula_marketing_release_rows_update_member ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_update_member
  ON public.formula_marketing_release_rows
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formula_marketing_releases r
      INNER JOIN public.formulas f ON f.id = r.formula_id
      INNER JOIN public.organization_memberships om ON om.organization_id = f.organization_id
      WHERE r.id = release_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.formula_marketing_releases r
      INNER JOIN public.formulas f ON f.id = r.formula_id
      INNER JOIN public.organization_memberships om ON om.organization_id = f.organization_id
      WHERE r.id = release_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS formula_marketing_release_rows_delete_member ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_delete_member
  ON public.formula_marketing_release_rows
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.formula_marketing_releases r
      INNER JOIN public.formulas f ON f.id = r.formula_id
      INNER JOIN public.organization_memberships om ON om.organization_id = f.organization_id
      WHERE r.id = release_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS formula_marketing_release_rows_select_platform_admin ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_select_platform_admin
  ON public.formula_marketing_release_rows
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS formula_marketing_release_rows_insert_platform_admin ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_insert_platform_admin
  ON public.formula_marketing_release_rows
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS formula_marketing_release_rows_update_platform_admin ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_update_platform_admin
  ON public.formula_marketing_release_rows
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS formula_marketing_release_rows_delete_platform_admin ON public.formula_marketing_release_rows;
CREATE POLICY formula_marketing_release_rows_delete_platform_admin
  ON public.formula_marketing_release_rows
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 5) formulas: allow unauthenticated read of public marketing formulas
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS formulas_select_public ON public.formulas;
CREATE POLICY formulas_select_public
  ON public.formulas
  FOR SELECT
  TO anon, authenticated
  USING (visibility = 'public');

-- ---------------------------------------------------------------------------
-- 6) Grants
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.formula_marketing_releases TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.formula_marketing_releases TO authenticated, service_role;

GRANT SELECT ON public.formula_marketing_release_rows TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.formula_marketing_release_rows TO authenticated, service_role;

COMMIT;
