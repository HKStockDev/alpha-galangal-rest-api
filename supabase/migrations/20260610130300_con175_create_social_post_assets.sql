BEGIN;

CREATE TABLE public.social_post_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  social_post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('image', 'video', 'gif')),
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  public_url text,
  mime_type text,
  width integer,
  height integer,
  duration_seconds numeric(10,3),
  sort_order integer NOT NULL DEFAULT 0,
  source_kind text NOT NULL DEFAULT 'upload' CHECK (
    source_kind IN ('upload', 'generated', 'provider_import')
  ),
  art_template_key text REFERENCES public.social_render_templates(template_key) ON DELETE SET NULL,
  art_template_version integer,
  generation_provider text,
  generation_model text,
  generation_job_id text,
  generation_status text CHECK (
    generation_status IN ('pending', 'ready', 'failed')
  ),
  generation_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (social_post_id, sort_order)
);

COMMENT ON COLUMN public.social_post_assets.art_template_key IS
  'When this asset was rendered from a code template, record which layout was used.';

COMMENT ON COLUMN public.social_post_assets.generation_params IS
  'May include prompt_template_key snapshot, slide index, renderer inputs.';

CREATE TRIGGER trg_social_post_assets_set_updated_at
BEFORE UPDATE ON public.social_post_assets
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_social_post_assets_post ON public.social_post_assets (social_post_id);
CREATE INDEX idx_social_post_assets_generation_status
  ON public.social_post_assets (generation_status)
  WHERE generation_status IS NOT NULL;

COMMIT;
