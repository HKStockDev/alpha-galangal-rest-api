BEGIN;

INSERT INTO prompts (key, category, name, description)
VALUES
  ('sector_cycle_score', 'cycle', 'Sector Cycle Score', 'LLM outputs cycle score (1, 0, -1) per horizon for a sector'),
  ('industry_cycle_score', 'cycle', 'Industry Cycle Score', 'LLM outputs cycle score (1, 0, -1) per horizon for an industry'),
  ('sub_industry_cycle_score', 'cycle', 'Sub-Industry Cycle Score', 'LLM outputs cycle score (1, 0, -1) per horizon for a sub-industry')
ON CONFLICT (key) DO NOTHING;

INSERT INTO prompt_versions (prompt_id, version, status, system_prompt, user_prompt_template, output_schema, notes, model_name, temperature, top_p, max_output_tokens, created_at)
SELECT p.id, 1, 'active',
  $SYS$
You are a cycle analyst. For the given taxonomy level (sector, industry, or sub-industry), output a cycle score for each time horizon. Use only these values: 1 (positive/favorable cycle), 0 (neutral), -1 (negative/unfavorable cycle). Return valid JSON only; no markdown.
$SYS$,
  $USR$
Taxonomy level: {{level}}
Name: {{name}}
Code: {{code}}
Description: {{description}}

Output cycle scores for 6-month, 12-month, and 24-month horizons. Use only 1, 0, or -1 per horizon.

Return JSON: {"6m": <1|0|-1>, "12m": <1|0|-1>, "24m": <1|0|-1>}
$USR$,
  '{"type":"object","required":["6m","12m","24m"],"properties":{"6m":{"enum":[1,0,-1]},"12m":{"enum":[1,0,-1]},"24m":{"enum":[1,0,-1]}}}'::jsonb,
  'Initial version; 1/0/-1 scale.',
  'gemini-2.0-flash',
  0.2,
  NULL,
  256,
  now()
FROM prompts p
WHERE p.key = 'sector_cycle_score'
ON CONFLICT (prompt_id, version) DO NOTHING;

INSERT INTO prompt_versions (prompt_id, version, status, system_prompt, user_prompt_template, output_schema, notes, model_name, temperature, top_p, max_output_tokens, created_at)
SELECT p.id, 1, 'active',
  $SYS$
You are a cycle analyst. For the given taxonomy level (sector, industry, or sub-industry), output a cycle score for each time horizon. Use only these values: 1 (positive/favorable cycle), 0 (neutral), -1 (negative/unfavorable cycle). Return valid JSON only; no markdown.
$SYS$,
  $USR$
Taxonomy level: {{level}}
Name: {{name}}
Code: {{code}}
Description: {{description}}

Output cycle scores for 6-month, 12-month, and 24-month horizons. Use only 1, 0, or -1 per horizon.

Return JSON: {"6m": <1|0|-1>, "12m": <1|0|-1>, "24m": <1|0|-1>}
$USR$,
  '{"type":"object","required":["6m","12m","24m"],"properties":{"6m":{"enum":[1,0,-1]},"12m":{"enum":[1,0,-1]},"24m":{"enum":[1,0,-1]}}}'::jsonb,
  'Initial version; 1/0/-1 scale.',
  'gemini-2.0-flash',
  0.2,
  NULL,
  256,
  now()
FROM prompts p
WHERE p.key = 'industry_cycle_score'
ON CONFLICT (prompt_id, version) DO NOTHING;

INSERT INTO prompt_versions (prompt_id, version, status, system_prompt, user_prompt_template, output_schema, notes, model_name, temperature, top_p, max_output_tokens, created_at)
SELECT p.id, 1, 'active',
  $SYS$
You are a cycle analyst. For the given taxonomy level (sector, industry, or sub-industry), output a cycle score for each time horizon. Use only these values: 1 (positive/favorable cycle), 0 (neutral), -1 (negative/unfavorable cycle). Return valid JSON only; no markdown.
$SYS$,
  $USR$
Taxonomy level: {{level}}
Name: {{name}}
Code: {{code}}
Description: {{description}}

Output cycle scores for 6-month, 12-month, and 24-month horizons. Use only 1, 0, or -1 per horizon.

Return JSON: {"6m": <1|0|-1>, "12m": <1|0|-1>, "24m": <1|0|-1>}
$USR$,
  '{"type":"object","required":["6m","12m","24m"],"properties":{"6m":{"enum":[1,0,-1]},"12m":{"enum":[1,0,-1]},"24m":{"enum":[1,0,-1]}}}'::jsonb,
  'Initial version; 1/0/-1 scale.',
  'gemini-2.0-flash',
  0.2,
  NULL,
  256,
  now()
FROM prompts p
WHERE p.key = 'sub_industry_cycle_score'
ON CONFLICT (prompt_id, version) DO NOTHING;

UPDATE prompts
SET active_prompt_version_id = (SELECT pv.id FROM prompt_versions pv WHERE pv.prompt_id = prompts.id AND pv.version = 1 LIMIT 1),
    updated_at = now()
WHERE key IN ('sector_cycle_score', 'industry_cycle_score', 'sub_industry_cycle_score')
  AND active_prompt_version_id IS NULL;

COMMIT;
