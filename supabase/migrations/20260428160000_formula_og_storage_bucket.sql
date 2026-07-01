-- Open Graph (SEO) images for formula hub and release pages; URLs in seo_og_image_url

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('formula-og', 'formula-og', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS formula_og_select_public ON storage.objects;
CREATE POLICY formula_og_select_public
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'formula-og');

COMMIT;
