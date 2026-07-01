-- 20260506110000_create_assistant_core_config.sql
-- Single-row global assistant runtime defaults (MVP, no profile layer yet).

BEGIN;

CREATE TABLE IF NOT EXISTS public.assistant_core_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ensure exactly one active config "slot" in MVP.
  config_key text NOT NULL UNIQUE DEFAULT 'default',

  is_active boolean NOT NULL DEFAULT true,

  -- Model/runtime defaults (global baseline, not billing controls).
  model_provider text NOT NULL DEFAULT 'openai',
  model_name text NOT NULL DEFAULT 'gpt-4.1-mini',
  temperature numeric(4,3) NOT NULL DEFAULT 0.200,
  max_output_tokens integer NOT NULL DEFAULT 1200,
  default_locale text NOT NULL DEFAULT 'en-US',

  -- Lightweight change/version tracking for future history support.
  version integer NOT NULL DEFAULT 1,
  change_note text,

  created_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assistant_core_config_temperature_range
    CHECK (temperature >= 0 AND temperature <= 2),
  CONSTRAINT assistant_core_config_max_output_tokens_positive
    CHECK (max_output_tokens > 0)
);

COMMENT ON TABLE public.assistant_core_config IS
  'MVP single global assistant config (model/runtime defaults + activation/version metadata).';

COMMENT ON COLUMN public.assistant_core_config.config_key IS
  'Single-slot key for MVP. Keep as ''default'' until moving to multi-profile architecture.';

COMMENT ON COLUMN public.assistant_core_config.version IS
  'Monotonic config version to support later snapshot/history features.';

-- Keep updated_at fresh on edits.
DROP TRIGGER IF EXISTS trg_assistant_core_config_set_updated_at ON public.assistant_core_config;
CREATE TRIGGER trg_assistant_core_config_set_updated_at
  BEFORE UPDATE ON public.assistant_core_config
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed exactly one default row if none exists.
INSERT INTO public.assistant_core_config (
  config_key,
  is_active,
  model_provider,
  model_name,
  temperature,
  max_output_tokens,
  default_locale,
  version,
  change_note
)
VALUES (
  'default',
  true,
  'openai',
  'gpt-4.1-mini',
  0.200,
  1200,
  'en-US',
  1,
  'Initial assistant core config'
)
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
