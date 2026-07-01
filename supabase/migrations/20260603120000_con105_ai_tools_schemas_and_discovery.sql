-- Real tool JSON schemas, discovery tools, system_prompt_tools, plan entitlements for chat.

BEGIN;

INSERT INTO public.ai_capabilities (capability_key, display_name, description, is_mutating, default_requires_confirmation)
VALUES
  ('client.lookup', 'Client Lookup', 'Search organization clients and entities', false, false),
  ('release.read', 'Release Status', 'Read formula marketing release status', false, false),
  ('jobs.read', 'Jobs Read', 'Read recent job sync activity', false, false),
  ('org.read', 'Organization Summary', 'Organization resource counts', false, false)
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO public.ai_capability_policies (capability_key, is_enabled, requires_confirmation, policy_mode)
SELECT capability_key, true, default_requires_confirmation, 'strict'
FROM public.ai_capabilities
WHERE capability_key IN ('client.lookup', 'release.read', 'jobs.read', 'org.read')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO public.ai_tools (
  tool_key, capability_key, display_name, description, input_schema_json, output_schema_json, timeout_ms, rate_limit_per_minute
)
VALUES
  (
    'tool.client.lookup',
    'client.lookup',
    'Client Lookup',
    'Find clients by name and load client details',
    '{
      "type": "object",
      "properties": {
        "name_query": { "type": "string", "description": "Partial client name" },
        "client_id": { "type": "string", "format": "uuid", "description": "Exact client id" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
      }
    }'::jsonb,
    '{"type": "object"}'::jsonb,
    10000,
    120
  ),
  (
    'tool.org.summary',
    'org.read',
    'Organization Summary',
    'Counts of clients, watchlists, and formulas for the organization',
    '{"type": "object", "properties": {}}'::jsonb,
    '{"type": "object"}'::jsonb,
    10000,
    120
  ),
  (
    'tool.release.status',
    'release.read',
    'Release Status',
    'Latest formula marketing releases',
    '{
      "type": "object",
      "properties": {
        "formula_id": { "type": "string", "format": "uuid" },
        "ticker": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 }
      }
    }'::jsonb,
    '{"type": "object"}'::jsonb,
    10000,
    120
  )
ON CONFLICT (tool_key) DO NOTHING;

UPDATE public.ai_tools SET
  input_schema_json = '{
    "type": "object",
    "properties": {
      "global_only": { "type": "boolean" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
    }
  }'::jsonb,
  output_schema_json = '{"type": "object"}'::jsonb
WHERE tool_key = 'tool.watchlist.read';

UPDATE public.ai_tools SET
  input_schema_json = '{
    "type": "object",
    "properties": {
      "formula_id": { "type": "string", "format": "uuid" },
      "name_query": { "type": "string" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
    }
  }'::jsonb,
  output_schema_json = '{"type": "object"}'::jsonb
WHERE tool_key = 'tool.formula.read';

UPDATE public.ai_tools SET
  input_schema_json = '{"type": "object", "properties": { "content": { "type": "string" } }, "required": ["content"]}'::jsonb
WHERE tool_key IN ('tool.chat.global', 'tool.chat.client');

INSERT INTO public.ai_prompt_templates (template_key, template_text, required_context_keys, change_note)
VALUES (
  'system_prompt_tools',
  'You have read-only tools to fetch organization data. Always use tools for factual lookups instead of guessing. Call at most one tool per step. After tool results, answer concisely.',
  '[]'::jsonb,
  'CON-105 seed'
)
ON CONFLICT (template_key) DO NOTHING;

UPDATE public.assistant_core_config
SET model_provider = 'gemini',
    model_name = 'gemini-2.5-flash',
    change_note = COALESCE(change_note, '') || ' CON-105 default provider'
WHERE config_key = 'default';

INSERT INTO public.subscription_plan_entitlements (
  plan_id, capability_key, is_enabled, quota_period, quota_limit, hard_block, upsell_message
)
SELECT p.id, cap.capability_key, true, NULL, NULL, false, NULL
FROM public.subscription_plans p
CROSS JOIN (
  VALUES
    ('chat.global'),
    ('chat.client'),
    ('client.lookup'),
    ('release.read'),
    ('org.read'),
    ('watchlist.read'),
    ('formula.read')
) AS cap(capability_key)
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

INSERT INTO public.ai_capability_credit_costs (capability_key, credits_cost, is_enabled)
VALUES
  ('client.lookup', 0, true),
  ('release.read', 0, true),
  ('org.read', 0, true)
ON CONFLICT (capability_key) DO NOTHING;

COMMIT;
