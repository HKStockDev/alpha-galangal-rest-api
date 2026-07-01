-- 20260506122000_create_ai_formula_disclosure_policies.sql
-- Global formula explanation/equation disclosure policy.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_formula_disclosure_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE DEFAULT 'default',
  block_exact_equation_for_system_formulas boolean NOT NULL DEFAULT true,
  allow_factor_names boolean NOT NULL DEFAULT true,
  allow_weights boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_ai_formula_disclosure_policies_set_updated_at ON public.ai_formula_disclosure_policies;
CREATE TRIGGER trg_ai_formula_disclosure_policies_set_updated_at
  BEFORE UPDATE ON public.ai_formula_disclosure_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.ai_formula_disclosure_policies (
  policy_key,
  block_exact_equation_for_system_formulas,
  allow_factor_names,
  allow_weights
)
VALUES ('default', true, true, false)
ON CONFLICT (policy_key) DO NOTHING;

COMMIT;
