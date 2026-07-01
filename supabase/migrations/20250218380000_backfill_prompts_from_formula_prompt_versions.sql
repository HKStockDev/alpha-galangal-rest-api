BEGIN;

INSERT INTO prompts (key, category, name, description)
SELECT
  f.key,
  'formula',
  f.name,
  'LLM formula prompt: ' || f.name
FROM formulas f
WHERE f.key = 'alpha_galangal_committee_llm'
  AND EXISTS (SELECT 1 FROM formula_prompt_versions fpv WHERE fpv.formula_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM prompts p WHERE p.key = f.key)
ON CONFLICT (key) DO NOTHING;

INSERT INTO prompt_versions (
  prompt_id,
  version,
  status,
  system_prompt,
  user_prompt_template,
  output_schema,
  notes,
  model_name,
  temperature,
  top_p,
  max_output_tokens,
  created_at
)
SELECT
  p.id,
  fpv.version,
  fpv.status,
  fpv.system_prompt,
  fpv.user_prompt_template,
  fpv.output_schema::jsonb,
  fpv.notes,
  fpv.model_name,
  fpv.temperature,
  fpv.top_p,
  fpv.max_output_tokens,
  fpv.created_at
FROM formula_prompt_versions fpv
JOIN formulas f ON f.id = fpv.formula_id
JOIN prompts p ON p.key = f.key
WHERE f.key = 'alpha_galangal_committee_llm'
ON CONFLICT (prompt_id, version) DO NOTHING;

UPDATE prompts
SET active_prompt_version_id = (
  SELECT pv.id
  FROM prompt_versions pv
  JOIN prompts p ON p.id = pv.prompt_id
  WHERE p.key = 'alpha_galangal_committee_llm'
    AND pv.version = 1
  LIMIT 1
),
updated_at = now()
WHERE key = 'alpha_galangal_committee_llm'
  AND active_prompt_version_id IS NULL;

COMMIT;
