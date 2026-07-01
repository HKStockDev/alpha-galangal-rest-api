BEGIN;

-- CON-174: RLS for social OAuth + posting tables (API uses service role; block direct client access).

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_account_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_assets ENABLE ROW LEVEL SECURITY;

-- Platform admins only (Precision social MVP).
DROP POLICY IF EXISTS social_accounts_platform_admin ON public.social_accounts;
CREATE POLICY social_accounts_platform_admin
  ON public.social_accounts
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS social_account_credentials_platform_admin ON public.social_account_credentials;
CREATE POLICY social_account_credentials_platform_admin
  ON public.social_account_credentials
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS social_posts_platform_admin ON public.social_posts;
CREATE POLICY social_posts_platform_admin
  ON public.social_posts
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS social_publish_attempts_platform_admin ON public.social_publish_attempts;
CREATE POLICY social_publish_attempts_platform_admin
  ON public.social_publish_attempts
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS social_post_assets_platform_admin ON public.social_post_assets;
CREATE POLICY social_post_assets_platform_admin
  ON public.social_post_assets
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Read-only reference data for authenticated users (prompt/spec catalogs).
ALTER TABLE public.social_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_render_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_render_template_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_platform_post_specs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_prompt_templates_select_authenticated ON public.social_prompt_templates;
CREATE POLICY social_prompt_templates_select_authenticated
  ON public.social_prompt_templates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS social_prompt_templates_write_platform_admin ON public.social_prompt_templates;
CREATE POLICY social_prompt_templates_write_platform_admin
  ON public.social_prompt_templates
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS social_render_templates_select_authenticated ON public.social_render_templates;
CREATE POLICY social_render_templates_select_authenticated
  ON public.social_render_templates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS social_render_templates_write_platform_admin ON public.social_render_templates;
CREATE POLICY social_render_templates_write_platform_admin
  ON public.social_render_templates
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS social_render_template_prompts_platform_admin ON public.social_render_template_prompts;
CREATE POLICY social_render_template_prompts_platform_admin
  ON public.social_render_template_prompts
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS social_platform_post_specs_select_authenticated ON public.social_platform_post_specs;
CREATE POLICY social_platform_post_specs_select_authenticated
  ON public.social_platform_post_specs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS social_platform_post_specs_write_platform_admin ON public.social_platform_post_specs;
CREATE POLICY social_platform_post_specs_write_platform_admin
  ON public.social_platform_post_specs
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

COMMIT;
