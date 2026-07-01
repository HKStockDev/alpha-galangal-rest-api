-- 20260506114000_create_ai_capabilities.sql
-- Canonical capability registry.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_capabilities (
  capability_key text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_mutating boolean NOT NULL DEFAULT false,
  default_requires_confirmation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_ai_capabilities_set_updated_at ON public.ai_capabilities;
CREATE TRIGGER trg_ai_capabilities_set_updated_at
  BEFORE UPDATE ON public.ai_capabilities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_capabilities (capability_key, display_name, description, is_mutating, default_requires_confirmation)
VALUES
  ('chat.global', 'Global Chat', 'Organization-level conversational support', false, false),
  ('chat.client', 'Client Chat', 'Client-scoped conversational support', false, false),
  ('watchlist.read', 'Read Watchlists', 'List and inspect watchlists', false, false),
  ('watchlist.create', 'Create Watchlist', 'Create a new watchlist', true, true),
  ('watchlist.add_stocks', 'Add Stocks To Watchlist', 'Add stocks to an existing watchlist', true, true),
  ('watchlist.remove_stocks', 'Remove Stocks From Watchlist', 'Remove stocks from an existing watchlist', true, true),
  ('formula.read', 'Read Formulas', 'Read formulas and metadata', false, false),
  ('formula.create', 'Create Formula', 'Create a new formula', true, true),
  ('formula.explain', 'Explain Formula', 'Explain formula logic subject to disclosure policy', false, false),
  ('screen.run', 'Run Screening', 'Run screening against formula/factor constraints', false, false),
  ('watchlist.create_from_screen', 'Create Watchlist From Screening', 'Create watchlist from screening output', true, true)
ON CONFLICT (capability_key) DO NOTHING;

COMMIT;
