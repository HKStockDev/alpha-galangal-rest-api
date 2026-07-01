-- SEO fields for public formula hub pages and per-release marketing pages.

BEGIN;

ALTER TABLE public.formulas
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_og_image_url text;

COMMENT ON COLUMN public.formulas.seo_title IS
  'Optional <title> / JSON-LD; falls back to name in clients when null.';
COMMENT ON COLUMN public.formulas.seo_description IS
  'Optional meta description for the formula marketing hub.';
COMMENT ON COLUMN public.formulas.seo_og_image_url IS
  'Optional Open Graph / social image; falls back to hero_image_url in clients when null.';

ALTER TABLE public.formula_marketing_releases
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_og_image_url text;

COMMENT ON COLUMN public.formula_marketing_releases.seo_title IS
  'Optional <title> for this release page; falls back to title when null.';
COMMENT ON COLUMN public.formula_marketing_releases.seo_description IS
  'Optional meta description for this release page.';
COMMENT ON COLUMN public.formula_marketing_releases.seo_og_image_url IS
  'Optional Open Graph image; falls back to hero_image_url when null.';

COMMIT;
