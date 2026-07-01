-- 20260506162000_add_factor_prompt_templates.sql
-- Adds factor-aware prompt templates/guardrails for chat-assisted formula creation.

BEGIN;

INSERT INTO public.ai_prompt_templates (template_key, template_text, required_context_keys, change_note)
VALUES
  (
    'prompt_template_factor_create',
    'Create a new organization-owned factor only when the request is explicit and valid.',
    '["organization_id","user_id","factor_name","factor_key","value_type"]'::jsonb,
    'Add factor creation task template'
  ),
  (
    'prompt_template_factor_explain',
    'Explain factor semantics and interpretation without exposing hidden system internals.',
    '["organization_id","user_id","factor_id"]'::jsonb,
    'Add factor explanation task template'
  ),
  (
    'prompt_template_formula_create_with_factor_policy',
    'Create formulas using only allowed factors provided in context. Do not use hidden or disallowed factors. If requested factors are unavailable, ask for alternatives.',
    '["organization_id","user_id","formula_name","allowed_factor_keys"]'::jsonb,
    'Add factor policy-aware formula creation template'
  ),
  (
    'prompt_restriction_no_hidden_system_factors',
    'Never reveal or rely on hidden system-only factors to organization users. Use only public system factors and organization-accessible factors.',
    '[]'::jsonb,
    'Add hidden system factor guardrail'
  )
ON CONFLICT (template_key) DO NOTHING;

COMMIT;
