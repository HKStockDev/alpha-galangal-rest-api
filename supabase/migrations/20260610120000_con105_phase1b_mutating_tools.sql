-- CON-105 Phase 1b: mutating tool schemas, pending actions, plan entitlements, credits.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_llm_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.organization_llm_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tool_key text NOT NULL,
  capability_key text NOT NULL REFERENCES public.ai_capabilities(capability_key) ON DELETE CASCADE,
  args_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_org_llm_pending_actions_conversation_status
  ON public.organization_llm_pending_actions (conversation_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_llm_pending_actions_expires
  ON public.organization_llm_pending_actions (expires_at)
  WHERE status = 'pending';

UPDATE public.ai_tools SET
  description = 'Create a new organization or client-scoped watchlist',
  input_schema_json = '{
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Watchlist name" },
      "description": { "type": "string" },
      "organization_client_id": { "type": "string", "format": "uuid" }
    },
    "required": ["name"]
  }'::jsonb
WHERE tool_key = 'tool.watchlist.create';

UPDATE public.ai_tools SET
  description = 'Add one or more tickers to an existing watchlist',
  input_schema_json = '{
    "type": "object",
    "properties": {
      "watchlist_id": { "type": "string", "format": "uuid" },
      "watchlist_name": { "type": "string" },
      "tickers": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 1
      }
    },
    "required": ["tickers"]
  }'::jsonb
WHERE tool_key = 'tool.watchlist.add_stocks';

UPDATE public.ai_tools SET
  description = 'Remove tickers from an existing watchlist',
  input_schema_json = '{
    "type": "object",
    "properties": {
      "watchlist_id": { "type": "string", "format": "uuid" },
      "watchlist_name": { "type": "string" },
      "tickers": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 1
      }
    },
    "required": ["tickers"]
  }'::jsonb
WHERE tool_key = 'tool.watchlist.remove_stocks';

UPDATE public.ai_tools SET
  description = 'Create an organization-owned formula',
  input_schema_json = '{
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "display_formula": { "type": "string", "description": "Human-readable equation or expression" },
      "description": { "type": "string" }
    },
    "required": ["name", "display_formula"]
  }'::jsonb
WHERE tool_key = 'tool.formula.create';

UPDATE public.ai_tools SET
  description = 'Run the multi-formula stock screener with optional score filters',
  input_schema_json = '{
    "type": "object",
    "properties": {
      "q": { "type": "string", "description": "Ticker or name search" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 50 },
      "min_fundamental_constriction_score": { "type": "number" },
      "max_fundamental_constriction_score": { "type": "number" },
      "min_net_exposure_score": { "type": "number" },
      "max_net_exposure_score": { "type": "number" },
      "min_insider_precision_score": { "type": "number" },
      "max_insider_precision_score": { "type": "number" },
      "min_political_score": { "type": "number" },
      "max_political_score": { "type": "number" },
      "sort_by": {
        "type": "string",
        "enum": ["ticker", "fundamental_constriction_score", "net_exposure_score", "insider_precision_score", "political_score"]
      },
      "sort_dir": { "type": "string", "enum": ["asc", "desc"] }
    }
  }'::jsonb
WHERE tool_key = 'tool.screen.run';

UPDATE public.ai_tools SET
  description = 'Create a watchlist from current multi-formula screener results',
  input_schema_json = '{
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "description": { "type": "string" },
      "organization_client_id": { "type": "string", "format": "uuid" },
      "q": { "type": "string" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 500 },
      "min_fundamental_constriction_score": { "type": "number" },
      "max_fundamental_constriction_score": { "type": "number" },
      "min_net_exposure_score": { "type": "number" },
      "max_net_exposure_score": { "type": "number" },
      "min_insider_precision_score": { "type": "number" },
      "max_insider_precision_score": { "type": "number" },
      "min_political_score": { "type": "number" },
      "max_political_score": { "type": "number" }
    },
    "required": ["name"]
  }'::jsonb
WHERE tool_key = 'tool.watchlist.create_from_screen';

INSERT INTO public.ai_tools (
  tool_key, capability_key, display_name, description, input_schema_json, output_schema_json, timeout_ms, rate_limit_per_minute
)
VALUES (
  'tool.formula.explain',
  'formula.explain',
  'Formula Explain',
  'Explain formula behavior subject to disclosure policy',
  '{
    "type": "object",
    "properties": {
      "formula_id": { "type": "string", "format": "uuid" },
      "name_query": { "type": "string" }
    }
  }'::jsonb,
  '{"type": "object"}'::jsonb,
  10000,
  120
)
ON CONFLICT (tool_key) DO UPDATE SET
  input_schema_json = EXCLUDED.input_schema_json,
  description = EXCLUDED.description;

UPDATE public.ai_prompt_templates
SET template_text = 'You have tools to fetch and change organization data. Use tools for factual lookups instead of guessing. Mutating tools (create watchlist, add/remove stocks, create formula, create watchlist from screen) require user confirmation — describe the action clearly when proposing them. Call at most one tool per step. After tool results, answer concisely.',
    change_note = COALESCE(change_note, '') || ' CON-105 Phase 1b'
WHERE template_key = 'system_prompt_tools';

INSERT INTO public.subscription_plan_entitlements (
  plan_id, capability_key, is_enabled, quota_period, quota_limit, hard_block, upsell_message
)
SELECT p.id, cap.capability_key, true, NULL, NULL, false, NULL
FROM public.subscription_plans p
CROSS JOIN (
  VALUES
    ('watchlist.create'),
    ('watchlist.add_stocks'),
    ('watchlist.remove_stocks'),
    ('formula.create'),
    ('formula.explain'),
    ('screen.run'),
    ('watchlist.create_from_screen')
) AS cap(capability_key)
WHERE p.is_active = true
ON CONFLICT (plan_id, capability_key) DO NOTHING;

INSERT INTO public.ai_capability_credit_costs (capability_key, credits_cost, is_enabled)
VALUES
  ('watchlist.create', 1, true),
  ('watchlist.add_stocks', 0, true),
  ('watchlist.remove_stocks', 0, true),
  ('watchlist.create_from_screen', 2, true),
  ('formula.explain', 1, true)
ON CONFLICT (capability_key) DO UPDATE SET
  credits_cost = EXCLUDED.credits_cost,
  is_enabled = EXCLUDED.is_enabled;

COMMIT;
