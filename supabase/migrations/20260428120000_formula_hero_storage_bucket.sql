-- Public bucket for marketing formula hero images; URLs stored on public.formulas.hero_image_url

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('formula-heroes', 'formula-heroes', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS formula_heroes_select_public ON storage.objects;
CREATE POLICY formula_heroes_select_public
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'formula-heroes');

COMMIT;
