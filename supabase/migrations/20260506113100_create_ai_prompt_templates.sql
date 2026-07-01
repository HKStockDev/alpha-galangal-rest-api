-- 20260506113100_create_ai_prompt_templates.sql
-- (Renumbered from 20260506113000: that version is used by client_entities_v2_profile_compliance.)
-- Stores system/task prompt templates for the MVP assistant.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  template_text text NOT NULL,
  required_context_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  change_note text,
  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prompt_templates_required_context_keys_is_array
    CHECK (jsonb_typeof(required_context_keys) = 'array')
);

COMMENT ON TABLE public.ai_prompt_templates IS
  'Prompt templates keyed by task/system role for a single-assistant MVP.';

COMMENT ON COLUMN public.ai_prompt_templates.template_key IS
  'Unique key (e.g. system_prompt_core, prompt_template_screening_request).';

DROP TRIGGER IF EXISTS trg_ai_prompt_templates_set_updated_at ON public.ai_prompt_templates;
CREATE TRIGGER trg_ai_prompt_templates_set_updated_at
  BEFORE UPDATE ON public.ai_prompt_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_prompt_templates (template_key, template_text, required_context_keys, change_note)
VALUES
  ('system_prompt_core', 'You are an organization-side investment assistant.', '[]'::jsonb, 'Initial seed'),
  ('system_prompt_safety', 'Do not provide personalized financial advice. Follow organization policy.', '[]'::jsonb, 'Initial seed'),
  ('system_prompt_style', 'Be concise, factual, and action-oriented.', '[]'::jsonb, 'Initial seed'),
  ('prompt_template_global_chat', 'Answer the user within organization scope.', '["organization_id","user_id"]'::jsonb, 'Initial seed'),
  ('prompt_template_client_chat', 'Answer the user in the active client scope.', '["organization_id","user_id","client_id"]'::jsonb, 'Initial seed'),
  ('prompt_template_watchlist_understanding', 'Resolve watchlist intent before acting.', '["organization_id","user_id"]'::jsonb, 'Initial seed'),
  ('prompt_template_watchlist_create', 'Create a new watchlist from user input.', '["organization_id","user_id","watchlist_name"]'::jsonb, 'Initial seed'),
  ('prompt_template_watchlist_add_stocks', 'Add requested tickers to the selected watchlist.', '["organization_id","user_id","watchlist_id","tickers"]'::jsonb, 'Initial seed'),
  ('prompt_template_formula_create', 'Create a new organization formula from user intent.', '["organization_id","user_id","formula_name"]'::jsonb, 'Initial seed'),
  ('prompt_template_formula_explain_non_equation', 'Explain formula intent without revealing restricted exact equation details.', '["organization_id","user_id","formula_id"]'::jsonb, 'Initial seed'),
  ('prompt_template_screening_request', 'Run screening based on user constraints.', '["organization_id","user_id","screen_expression"]'::jsonb, 'Initial seed'),
  ('prompt_template_watchlist_create_from_screening', 'Create a watchlist from screening output.', '["organization_id","user_id","screen_result_id","watchlist_name"]'::jsonb, 'Initial seed')
ON CONFLICT (template_key) DO NOTHING;

COMMIT;
