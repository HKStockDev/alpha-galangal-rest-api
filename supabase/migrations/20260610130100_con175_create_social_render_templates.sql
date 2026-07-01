BEGIN;

CREATE TABLE public.social_render_templates (
  template_key text PRIMARY KEY,
  display_name text NOT NULL,
  description text,
  renderer text NOT NULL CHECK (
    renderer IN ('satori_v1', 'html_playwright_v1', 'code_registry_v1')
  ),
  layout_version integer NOT NULL DEFAULT 1,
  compatible_post_kinds text[] NOT NULL DEFAULT '{}'::text[],
  default_prompt_bundle jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_render_templates IS
  'Registry for code-backed art/layout templates (Satori/HTML/etc.). Implementation lives in app code; rows link posts to bundles and optional prompt rows.';

COMMENT ON COLUMN public.social_render_templates.renderer IS
  'code_registry_v1: layout resolved only in code by template_key + layout_version.';

COMMENT ON COLUMN public.social_render_templates.compatible_post_kinds IS
  'Subset of social_posts.post_kind values this renderer supports; empty = app-defined.';

COMMENT ON COLUMN public.social_render_templates.default_prompt_bundle IS
  'JSON map of slot name -> social_prompt_templates.template_key (string). Composer merges with social_posts.prompt_bundle overrides.';

CREATE TRIGGER trg_social_render_templates_set_updated_at
BEFORE UPDATE ON public.social_render_templates
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.social_render_template_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_template_key text NOT NULL REFERENCES public.social_render_templates(template_key) ON DELETE CASCADE,
  slot text NOT NULL,
  prompt_template_id uuid NOT NULL REFERENCES public.social_prompt_templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (render_template_key, slot, sort_order)
);

COMMENT ON TABLE public.social_render_template_prompts IS
  'Optional normalized links from a code-backed render template to concrete social_prompt_templates rows (FK).';

COMMENT ON COLUMN public.social_render_template_prompts.slot IS
  'e.g. caption_base, guardrail, image_generation, platform_overlay_1';

CREATE INDEX idx_social_render_template_prompts_render
  ON public.social_render_template_prompts (render_template_key);
CREATE INDEX idx_social_render_template_prompts_prompt
  ON public.social_render_template_prompts (prompt_template_id);

COMMIT;
