BEGIN;

CREATE TABLE public.social_platform_post_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (
    platform IN ('facebook', 'instagram', 'tiktok', 'stocktwits', 'x', 'linkedin')
  ),
  post_kind text NOT NULL CHECK (
    post_kind IN (
      'text',
      'single_image',
      'multi_image',
      'gif',
      'video',
      'reel',
      'story',
      'link_share',
      'thread_reply',
      'live_stream',
      'poll'
    )
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  api_support_level text NOT NULL DEFAULT 'yes' CHECK (
    api_support_level IN ('yes', 'partial', 'no')
  ),
  enforcement_mode text NOT NULL DEFAULT 'block' CHECK (
    enforcement_mode IN ('block', 'warn', 'auto_trim')
  ),
  csv_source_label text,
  facet_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_chars integer,
  max_chars integer,
  min_assets integer,
  max_assets integer,
  max_image_mb numeric(10,2),
  max_video_mb numeric(10,2),
  min_video_seconds numeric(10,3),
  max_video_seconds numeric(10,3),
  allowed_mime_types text[] NOT NULL DEFAULT '{}'::text[],
  allowed_aspect_ratios text[] NOT NULL DEFAULT '{}'::text[],
  supports_links boolean NOT NULL DEFAULT false,
  supports_hashtags boolean NOT NULL DEFAULT true,
  supports_mentions boolean NOT NULL DEFAULT true,
  notes text,
  spec_version integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, post_kind),
  CHECK (min_chars IS NULL OR max_chars IS NULL OR min_chars <= max_chars),
  CHECK (min_assets IS NULL OR max_assets IS NULL OR min_assets <= max_assets),
  CHECK (min_video_seconds IS NULL OR max_video_seconds IS NULL OR min_video_seconds <= max_video_seconds)
);

COMMENT ON TABLE public.social_platform_post_specs IS
  'Per-platform constraints for each canonical post_kind. StockTwits combinations use post_facets + facet_capabilities.';

COMMENT ON COLUMN public.social_platform_post_specs.csv_source_label IS
  'Trace to original MVP CSV row label.';

COMMENT ON COLUMN public.social_platform_post_specs.facet_capabilities IS
  'Which post_facets keys the publisher honors for this surface.';

CREATE TRIGGER trg_social_platform_post_specs_set_updated_at
BEFORE UPDATE ON public.social_platform_post_specs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_social_platform_post_specs_platform_enabled
  ON public.social_platform_post_specs (platform, is_enabled);

COMMIT;
