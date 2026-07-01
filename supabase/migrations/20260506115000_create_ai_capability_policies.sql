-- 20260506115000_create_ai_capability_policies.sql
-- Global capability toggles/policy overrides for MVP assistant.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_capability_policies (
  capability_key text PRIMARY KEY REFERENCES public.ai_capabilities(capability_key) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  requires_confirmation boolean NOT NULL DEFAULT false,
  policy_mode text NOT NULL DEFAULT 'strict',
  notes text,
  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_capability_policies_policy_mode_check
    CHECK (policy_mode IN ('strict', 'warn'))
);

DROP TRIGGER IF EXISTS trg_ai_capability_policies_set_updated_at ON public.ai_capability_policies;
CREATE TRIGGER trg_ai_capability_policies_set_updated_at
  BEFORE UPDATE ON public.ai_capability_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_capability_policies (capability_key, is_enabled, requires_confirmation, policy_mode)
SELECT capability_key, true, default_requires_confirmation, 'strict'
FROM public.ai_capabilities
ON CONFLICT (capability_key) DO NOTHING;

COMMIT;
