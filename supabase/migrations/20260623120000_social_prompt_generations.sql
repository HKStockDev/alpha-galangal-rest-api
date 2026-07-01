BEGIN;

CREATE TABLE public.social_prompt_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  generation_kind text NOT NULL CHECK (
    generation_kind IN ('caption', 'image_prompt', 'video_script')
  ),
  render_template_key text,
  platform text,
  post_kind text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_text text NOT NULL,
  resolved_prompt_keys text[] NOT NULL DEFAULT '{}'::text[],
  provider text NOT NULL DEFAULT 'gemini' CHECK (
    provider IN ('gemini', 'manual', 'woop_dashboard')
  ),
  woop_media_id text,
  status text NOT NULL DEFAULT 'text_only' CHECK (
    status IN ('text_only', 'media_linked', 'published')
  ),
  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_prompt_generations IS
  'Audit log of AI-composed captions, image prompts, and video scripts for social compose.';

CREATE INDEX idx_social_prompt_generations_org_created
  ON public.social_prompt_generations (organization_id, created_at DESC);
CREATE INDEX idx_social_prompt_generations_org_kind
  ON public.social_prompt_generations (organization_id, generation_kind);

ALTER TABLE public.social_prompt_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_prompt_generations_platform_admin ON public.social_prompt_generations;
CREATE POLICY social_prompt_generations_platform_admin
  ON public.social_prompt_generations
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

COMMIT;
