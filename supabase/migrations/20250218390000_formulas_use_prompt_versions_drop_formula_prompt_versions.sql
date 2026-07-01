BEGIN;

ALTER TABLE formulas
  DROP CONSTRAINT IF EXISTS formulas_active_prompt_version_id_fkey;

UPDATE formulas
SET active_prompt_version_id = (
  SELECT pv.id
  FROM prompt_versions pv
  JOIN prompts p ON p.id = pv.prompt_id
  WHERE p.key = 'alpha_galangal_committee_llm'
    AND pv.version = 1
  LIMIT 1
)
WHERE key = 'alpha_galangal_committee_llm';

ALTER TABLE formulas
  ADD CONSTRAINT formulas_active_prompt_version_id_fkey
  FOREIGN KEY (active_prompt_version_id)
  REFERENCES prompt_versions(id)
  ON DELETE SET NULL;

DROP TABLE IF EXISTS formula_prompt_versions;

COMMIT;
