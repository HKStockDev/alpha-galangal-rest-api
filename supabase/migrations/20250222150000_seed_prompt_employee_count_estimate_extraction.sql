BEGIN;

INSERT INTO prompts (key, category, name, description)
VALUES (
  'employee_count_estimate_extraction',
  'extraction',
  'Employee Count Estimate Extraction',
  'Extract best current estimate of company employee headcount from evidence; output rows for entity_factor_values_ts.'
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
You are a data extraction engine for a financial stock screener.

Your job is to determine the best current estimate of company employee headcount and return rows formatted for the PostgreSQL table `entity_factor_values_ts`.

Return ONLY valid JSON.
Do not include markdown.
Do not include explanations.
Do not include comments.

Goal:
Extract the most reliable employee count estimate from the provided evidence.

Rules:
- Prefer Apollo employee count estimates when available.
- Otherwise use LinkedIn employee estimates.
- If both exist, prefer Apollo.
- Do not use employee ranges unless no numeric estimate exists.
- If only a range exists and no numeric estimate is available, return {"rows": []}.
- Never invent numbers.

Output schema:

{
  "rows": [
    {
      "entity_id": "...",
      "factor_id": "...",
      "value_num": 36000,
      "value_text": null,
      "unit": "employees",
      "currency": null,
      "period_key": "instant",
      "fiscal_year": null,
      "fiscal_period": null,
      "start_date": null,
      "end_date": "YYYY-MM-DD",
      "period_of_report_date": null,
      "filing_date": null,
      "source": "apollo",
      "ingested_at": "YYYY-MM-DDTHH:MM:SSZ",
      "model_version": "v1",
      "period_months": null,
      "as_of_date": "YYYY-MM-DD"
    }
  ]
}

Rules for fields:
- entity_id must match the provided entity_id
- factor_id must match the provided factor_id
- unit must be "employees"
- period_key must be "instant"
- end_date must equal as_of_date
- fiscal_year, fiscal_period, start_date, filing_date, period_of_report_date must be null
- period_months must be null
- currency must be null
- value_num must be an integer
- value_text must be null
- source must be one of: "apollo","linkedin","company_site","derived"
$SYS$,
  $USR$
entity_id: {{entity_id}}
factor_id: {{factor_id}}
as_of_date: {{as_of_date}}

Evidence:
{{evidence}}
$USR$,
  '{
    "type": "object",
    "required": ["rows"],
    "properties": {
      "rows": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["entity_id", "factor_id", "value_num", "unit", "period_key", "end_date", "source", "ingested_at", "model_version", "as_of_date"],
          "properties": {
            "entity_id": { "type": "string" },
            "factor_id": { "type": "string" },
            "value_num": { "type": "number" },
            "value_text": { "type": ["string", "null"] },
            "unit": { "type": "string", "enum": ["employees"] },
            "currency": { "type": "null" },
            "period_key": { "type": "string", "enum": ["instant"] },
            "fiscal_year": { "type": "null" },
            "fiscal_period": { "type": "null" },
            "start_date": { "type": "null" },
            "end_date": { "type": "string", "format": "date" },
            "period_of_report_date": { "type": "null" },
            "filing_date": { "type": "null" },
            "source": { "type": "string", "enum": ["apollo", "linkedin", "company_site", "derived"] },
            "ingested_at": { "type": "string", "format": "date-time" },
            "model_version": { "type": "string" },
            "period_months": { "type": "null" },
            "as_of_date": { "type": "string", "format": "date" }
          }
        }
      }
    }
  }'::jsonb,
  'Extract employee count estimate for entity_factor_values_ts; v1.',
  'gemini-2.0-flash',
  0.1,
  NULL,
  1024,
  now()
FROM prompts p
WHERE p.key = 'employee_count_estimate_extraction'
ON CONFLICT (prompt_id, version) DO NOTHING;

UPDATE prompts
SET active_prompt_version_id = (
  SELECT pv.id FROM prompt_versions pv
  WHERE pv.prompt_id = prompts.id AND pv.version = 1
  LIMIT 1
),
updated_at = now()
WHERE key = 'employee_count_estimate_extraction'
  AND active_prompt_version_id IS NULL;

COMMIT;
