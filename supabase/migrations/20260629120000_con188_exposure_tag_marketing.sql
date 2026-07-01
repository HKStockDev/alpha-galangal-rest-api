-- CON-188: marketing fields for public exposure and tag hub pages

BEGIN;

-- ---------------------------------------------------------------------------
-- exposures: marketing fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.exposures
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS marketing_slug text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS marketing_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_og_image_url text;

ALTER TABLE public.exposures
  DROP CONSTRAINT IF EXISTS exposures_visibility_check;

ALTER TABLE public.exposures
  ADD CONSTRAINT exposures_visibility_check
  CHECK (visibility IN ('internal', 'public'));

COMMENT ON COLUMN public.exposures.visibility IS
  'internal = admin only; public = visible on marketing exposure hub pages.';
COMMENT ON COLUMN public.exposures.marketing_slug IS
  'URL segment for the public exposure hub (unique when set).';
COMMENT ON COLUMN public.exposures.marketing_settings IS
  'JSON: optional cta_key, public_ticker_limit, default_sort, etc.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_exposures_marketing_slug
  ON public.exposures (lower(btrim(marketing_slug)))
  WHERE marketing_slug IS NOT NULL AND btrim(marketing_slug) <> '';

-- ---------------------------------------------------------------------------
-- tags: marketing fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS marketing_slug text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS marketing_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_og_image_url text;

ALTER TABLE public.tags
  DROP CONSTRAINT IF EXISTS tags_visibility_check;

ALTER TABLE public.tags
  ADD CONSTRAINT tags_visibility_check
  CHECK (visibility IN ('internal', 'public'));

COMMENT ON COLUMN public.tags.visibility IS
  'internal = admin only; public = visible on marketing tag hub pages.';
COMMENT ON COLUMN public.tags.marketing_slug IS
  'URL segment for the public tag hub (unique when set).';
COMMENT ON COLUMN public.tags.marketing_settings IS
  'JSON: optional cta_key, public_ticker_limit, default_sort, etc.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_marketing_slug
  ON public.tags (lower(btrim(marketing_slug)))
  WHERE marketing_slug IS NOT NULL AND btrim(marketing_slug) <> '';

-- ---------------------------------------------------------------------------
-- Seed: active exposures + default-org tags → public with marketing slugs
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org_id uuid;
  v_settings jsonb := jsonb_build_object(
    'cta_key', 'Create Account',
    'public_ticker_limit', 5,
    'default_sort', 'score_desc'
  );
BEGIN
  UPDATE public.exposures
  SET
    visibility = 'public',
    marketing_slug = slug,
    marketing_settings = COALESCE(marketing_settings, '{}'::jsonb) || v_settings,
    updated_at = now()
  WHERE is_active = true
    AND btrim(slug) <> '';

  SELECT id INTO v_org_id
  FROM public.organizations
  WHERE slug = 'default-organization'
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    UPDATE public.tags
    SET
      visibility = 'public',
      marketing_slug = slug,
      marketing_settings = COALESCE(marketing_settings, '{}'::jsonb) || v_settings,
      updated_at = now()
    WHERE is_active = true
      AND organization_id = v_org_id
      AND btrim(slug) <> '';
  ELSE
    RAISE NOTICE 'con188_exposure_tag_marketing: default-organization not found; skip tag seed';
  END IF;
END $$;

COMMIT;
