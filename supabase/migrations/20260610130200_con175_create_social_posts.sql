BEGIN;

CREATE TABLE public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE RESTRICT,
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
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled')
  ),
  caption text,
  link_url text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_facets jsonb NOT NULL DEFAULT '{}'::jsonb,
  publish_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  external_post_url text,
  last_error_message text,
  art_template_key text REFERENCES public.social_render_templates(template_key) ON DELETE SET NULL,
  art_template_version integer,
  prompt_bundle jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_template_id uuid REFERENCES public.social_prompt_templates(id) ON DELETE SET NULL,
  prompt_template_version integer,
  prompt_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  generation_recipe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.social_posts IS
  'Outbound social post lifecycle. post_kind is the canonical delivery shape; CSV labels map via social_platform_post_specs.csv_source_label / notes.';

COMMENT ON COLUMN public.social_posts.post_facets IS
  'Combinatorial flags per platform. Examples: StockTwits {"sentiment":"bullish"|"bearish","cashtags":["AAPL"],"reply_to":{"external_message_id":"..."}}; LinkedIn {"presentation":"linkedin_document"}.';

COMMENT ON COLUMN public.social_posts.art_template_key IS
  'Code-backed layout id in social_render_templates; pixels rendered in application.';

COMMENT ON COLUMN public.social_posts.prompt_bundle IS
  'Merged over social_render_templates.default_prompt_bundle. Shape: { slot: { template_key, version? } } or { slot: template_key }.';

COMMENT ON COLUMN public.social_posts.prompt_template_id IS
  'Optional single primary prompt row; use prompt_bundle when composing base+overlays+guardrails.';

COMMENT ON COLUMN public.social_posts.generation_recipe_key IS
  'Optional recipe key when you add social_generation_recipes later.';

CREATE TRIGGER trg_social_posts_set_updated_at
BEFORE UPDATE ON public.social_posts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_social_posts_org_status_publish_at
  ON public.social_posts (organization_id, status, publish_at);
CREATE INDEX idx_social_posts_account_status
  ON public.social_posts (social_account_id, status);
CREATE INDEX idx_social_posts_post_kind ON public.social_posts (post_kind);
CREATE INDEX idx_social_posts_scheduled_queue
  ON public.social_posts (status, publish_at)
  WHERE status IN ('scheduled', 'publishing');

COMMIT;
