BEGIN;

CREATE TABLE public.social_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  channel text NOT NULL DEFAULT 'all' CHECK (
    channel IN ('all', 'facebook', 'instagram', 'tiktok', 'stocktwits', 'x', 'linkedin')
  ),
  post_kind text NOT NULL DEFAULT 'all' CHECK (
    post_kind IN (
      'all',
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
  purpose text NOT NULL CHECK (
    purpose IN (
      'caption',
      'hashtag_pack',
      'image_generation',
      'video_generation',
      'video_script',
      'thread_reply_body'
    )
  ),
  prompt_role text NOT NULL DEFAULT 'base' CHECK (
    prompt_role IN ('base', 'platform_overlay', 'post_kind_overlay', 'guardrail', 'normalizer')
  ),
  template_text text NOT NULL,
  required_context_keys text[] NOT NULL DEFAULT '{}'::text[],
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  change_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.social_prompt_templates IS
  'Social-only LLM prompt library. post_kind matches social_posts.post_kind; use channel=all for shared bases.';

COMMENT ON COLUMN public.social_prompt_templates.purpose IS
  'thread_reply_body: copy for reply/thread posts (e.g. StockTwits).';

CREATE TRIGGER trg_social_prompt_templates_set_updated_at
BEFORE UPDATE ON public.social_prompt_templates
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_social_prompt_templates_scope
  ON public.social_prompt_templates (channel, post_kind, purpose, prompt_role, is_active);

COMMIT;
