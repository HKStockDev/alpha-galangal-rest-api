BEGIN;

INSERT INTO prompts (key, category, name, description)
VALUES (
  'security_classification',
  'classification',
  'Security GICS Classification',
  'LLM assigns GICS sub-industry to securities'
)
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
  1,
  'active',
  $SYS$
You are a classifier that assigns a company to the best-matching GICS (Global Industry Classification Standard) sub-industry. You are given company details (ticker, name, SIC, description, etc.) and the full list of GICS sub_industries (code and title). Respond with exactly one best-matching GICS sub_industry code and a confidence between 0 and 1. Use the company description and business (homepage, SIC) to choose; SIC is a hint but not binding. Respond only with valid JSON (no markdown).
$SYS$,
  $USR$
Company to classify:
- ticker: {{ticker}}
- name: {{name}}
- sic_code: {{sic_code}}
- sic_description: {{sic_description}}
- description: {{description}}
- homepage_url: {{homepage_url}}
- primary_exchange: {{primary_exchange}}

GICS sub_industries (choose exactly one by its code):
{{sub_industries_list}}

Return JSON: {"gics_code":"<8-digit code>","confidence":<0-1 number>,"reasoning":"<short explanation>"}
$USR$,
  '{
    "type": "object",
    "required": ["gics_code", "confidence"],
    "properties": {
      "gics_code": { "type": "string" },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "reasoning": { "type": "string" }
    }
  }'::jsonb,
  'Initial version for GICS sub-industry classification.',
  'gemini-2.0-flash',
  0.2,
  NULL,
  512,
  now()
FROM prompts p
WHERE p.key = 'security_classification'
ON CONFLICT (prompt_id, version) DO NOTHING;

UPDATE prompts
SET active_prompt_version_id = (
  SELECT pv.id FROM prompt_versions pv
  WHERE pv.prompt_id = prompts.id AND pv.version = 1
  LIMIT 1
),
updated_at = now()
WHERE key = 'security_classification'
  AND active_prompt_version_id IS NULL;

COMMIT;
