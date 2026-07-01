BEGIN;

-- 1) PROMPTS (definition)
CREATE TABLE IF NOT EXISTS prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  category text NOT NULL,
  name text,
  description text,

  -- optional convenience pointer (useful for tagging/exposures)
  active_prompt_version_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT prompts_key_not_blank CHECK (btrim(key) <> ''),
  CONSTRAINT prompts_category_not_blank CHECK (btrim(category) <> '')
);

-- 2) PROMPT_VERSIONS (generalized)
CREATE TABLE IF NOT EXISTS prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  prompt_id uuid NOT NULL,
  version integer NOT NULL,
  status text NOT NULL,

  system_prompt text,
  user_prompt_template text,
  output_schema jsonb,
  notes text,

  model_name text,
  temperature numeric,
  top_p numeric,
  max_output_tokens integer,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_prompt_versions_prompt
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,

  CONSTRAINT prompt_versions_unique_per_prompt
    UNIQUE (prompt_id, version)
);

-- link prompts.active_prompt_version_id -> prompt_versions.id
ALTER TABLE prompts
  ADD CONSTRAINT fk_prompts_active_prompt_version
  FOREIGN KEY (active_prompt_version_id) REFERENCES prompt_versions(id) ON DELETE SET NULL;

COMMIT;
