-- 20260506121000_create_ai_scope_policies.sql
-- Global scope/context resolution policy for MVP assistant.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_scope_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE DEFAULT 'default',
  default_scope text NOT NULL DEFAULT 'organization',
  require_active_client_for_client_actions boolean NOT NULL DEFAULT true,
  watchlist_resolution_strategy text NOT NULL DEFAULT 'name_match_then_confirm',
  allow_cross_client_access boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_scope_policies_default_scope_check
    CHECK (default_scope IN ('organization', 'client')),
  CONSTRAINT ai_scope_policies_watchlist_resolution_strategy_check
    CHECK (watchlist_resolution_strategy IN ('name_match_then_confirm', 'id_only'))
);

DROP TRIGGER IF EXISTS trg_ai_scope_policies_set_updated_at ON public.ai_scope_policies;
CREATE TRIGGER trg_ai_scope_policies_set_updated_at
  BEFORE UPDATE ON public.ai_scope_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_scope_policies (
  policy_key,
  default_scope,
  require_active_client_for_client_actions,
  watchlist_resolution_strategy,
  allow_cross_client_access
)
VALUES ('default', 'organization', true, 'name_match_then_confirm', false)
ON CONFLICT (policy_key) DO NOTHING;

COMMIT;
