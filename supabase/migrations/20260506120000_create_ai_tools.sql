-- 20260506120000_create_ai_tools.sql
-- Tool registry for assistant action execution contracts.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_tools (
  tool_key text PRIMARY KEY,
  capability_key text NOT NULL REFERENCES public.ai_capabilities(capability_key) ON DELETE CASCADE,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_enabled boolean NOT NULL DEFAULT true,
  input_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms integer,
  rate_limit_per_minute integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_tools_timeout_ms_positive CHECK (timeout_ms IS NULL OR timeout_ms > 0),
  CONSTRAINT ai_tools_rate_limit_positive CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0)
);

DROP TRIGGER IF EXISTS trg_ai_tools_set_updated_at ON public.ai_tools;
CREATE TRIGGER trg_ai_tools_set_updated_at
  BEFORE UPDATE ON public.ai_tools
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_tools (
  tool_key, capability_key, display_name, description, input_schema_json, output_schema_json, timeout_ms, rate_limit_per_minute
)
VALUES
  ('tool.chat.global', 'chat.global', 'Global Chat Tool', 'Answer organization-level chat queries', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 15000, 120),
  ('tool.chat.client', 'chat.client', 'Client Chat Tool', 'Answer client-level chat queries', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 15000, 120),
  ('tool.watchlist.read', 'watchlist.read', 'Watchlist Read Tool', 'Read watchlists', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 10000, 120),
  ('tool.watchlist.create', 'watchlist.create', 'Watchlist Create Tool', 'Create watchlist', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 10000, 60),
  ('tool.watchlist.add_stocks', 'watchlist.add_stocks', 'Watchlist Add Stocks Tool', 'Add stocks to watchlist', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 10000, 60),
  ('tool.watchlist.remove_stocks', 'watchlist.remove_stocks', 'Watchlist Remove Stocks Tool', 'Remove stocks from watchlist', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 10000, 60),
  ('tool.formula.read', 'formula.read', 'Formula Read Tool', 'Read formula details', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 10000, 120),
  ('tool.formula.create', 'formula.create', 'Formula Create Tool', 'Create formula', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 15000, 40),
  ('tool.formula.explain', 'formula.explain', 'Formula Explain Tool', 'Explain formula with policy constraints', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 10000, 120),
  ('tool.screen.run', 'screen.run', 'Screening Tool', 'Run screening', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 20000, 60),
  ('tool.watchlist.create_from_screen', 'watchlist.create_from_screen', 'Create Watchlist From Screening Tool', 'Create watchlist from screening output', '{"type":"object"}'::jsonb, '{"type":"object"}'::jsonb, 15000, 40)
ON CONFLICT (tool_key) DO NOTHING;

COMMIT;
