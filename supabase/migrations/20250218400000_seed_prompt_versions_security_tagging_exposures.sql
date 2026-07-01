BEGIN;

-- Security Tagging: prompt_version v1
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
You are a security analyst assigning thematic and investment tags to securities. Your task is to select the most relevant tags from the provided list that apply to the given security based on its name, description, and any other context.

Rules:
1) Use ONLY tag slugs from the provided available_tags list. Do not invent or paraphrase tags.
2) Assign only tags that clearly apply. Prefer precision over volume.
3) For each assignment provide a confidence score between 0 and 1 and a brief evidence sentence.
4) Return valid JSON only. No markdown or code fences.
$SYS$,
  $USR$
Assign tags to this security.

Ticker: {{ticker}}
Name: {{name}}
Description: {{description}}

Available tags (use only these slugs):
{{tags_json}}

Return JSON with exactly this structure:
{
  "ticker": "",
  "assignments": [
    {
      "tag_slug": "",
      "confidence": 0.0,
      "evidence": ""
    }
  ]
}

Constraints:
- confidence must be between 0 and 1
- tag_slug must be one of the slugs from the available tags list
- evidence should be one short sentence
$USR$,
  '{
    "type": "object",
    "required": ["ticker", "assignments"],
    "properties": {
      "ticker": { "type": "string" },
      "assignments": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["tag_slug", "confidence"],
          "properties": {
            "tag_slug": { "type": "string" },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "evidence": { "type": "string" }
          }
        }
      }
    }
  }'::jsonb,
  'Initial version for LLM-based security tagging.',
  'gemini-2.0-flash',
  0.2,
  NULL,
  4096,
  now()
FROM prompts p
WHERE p.key = 'security_tagging'
ON CONFLICT (prompt_id, version) DO NOTHING;

-- Security Exposures: prompt_version v1
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
You are a security analyst assigning macro and thematic exposures to securities. For each exposure you must specify: the exposure (from the provided list), the direction (beneficiary / dependent / supplier / customer), and a strength between 0 and 1.

Direction meanings:
- beneficiary: the security benefits when this exposure/thematic rises
- dependent: the security is negatively affected when this exposure rises
- supplier: the security supplies or is upstream of this exposure
- customer: the security is a customer or downstream of this exposure

Rules:
1) Use ONLY exposure slugs from the provided available_exposures list.
2) direction must be exactly one of: beneficiary, dependent, supplier, customer.
3) strength must be between 0 and 1 (0 = no link, 1 = strong link).
4) Provide confidence 0–1 and brief evidence per assignment.
5) Return valid JSON only. No markdown or code fences.
$SYS$,
  $USR$
Assign exposures to this security.

Ticker: {{ticker}}
Name: {{name}}
Description: {{description}}

Available exposures (use only these slugs):
{{exposures_json}}

Return JSON with exactly this structure:
{
  "ticker": "",
  "assignments": [
    {
      "exposure_slug": "",
      "direction": "beneficiary",
      "strength": 0.0,
      "confidence": 0.0,
      "evidence": ""
    }
  ]
}

Constraints:
- direction must be one of: beneficiary, dependent, supplier, customer
- strength and confidence must be between 0 and 1
- exposure_slug must be one of the slugs from the available exposures list
$USR$,
  '{
    "type": "object",
    "required": ["ticker", "assignments"],
    "properties": {
      "ticker": { "type": "string" },
      "assignments": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["exposure_slug", "direction", "strength", "confidence"],
          "properties": {
            "exposure_slug": { "type": "string" },
            "direction": { "enum": ["beneficiary", "dependent", "supplier", "customer"] },
            "strength": { "type": "number", "minimum": 0, "maximum": 1 },
            "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
            "evidence": { "type": "string" }
          }
        }
      }
    }
  }'::jsonb,
  'Initial version for LLM-based security exposure assignment.',
  'gemini-2.0-flash',
  0.2,
  NULL,
  4096,
  now()
FROM prompts p
WHERE p.key = 'security_exposures'
ON CONFLICT (prompt_id, version) DO NOTHING;

-- Set active_prompt_version_id for both prompts
UPDATE prompts
SET active_prompt_version_id = (
  SELECT pv.id
  FROM prompt_versions pv
  WHERE pv.prompt_id = prompts.id
    AND pv.version = 1
  LIMIT 1
),
updated_at = now()
WHERE key IN ('security_tagging', 'security_exposures')
  AND active_prompt_version_id IS NULL;

COMMIT;
