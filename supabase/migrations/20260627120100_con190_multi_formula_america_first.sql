-- CON-190: extend multi-formula screener AI tool schemas with america_first_score

UPDATE public.ai_tools SET
  input_schema_json = '{
    "type": "object",
    "properties": {
      "q": { "type": "string", "description": "Ticker or name search" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 50 },
      "min_fundamental_constriction_score": { "type": "number" },
      "max_fundamental_constriction_score": { "type": "number" },
      "min_net_exposure_score": { "type": "number" },
      "max_net_exposure_score": { "type": "number" },
      "min_insider_conviction_score": { "type": "number" },
      "max_insider_conviction_score": { "type": "number" },
      "min_political_score": { "type": "number" },
      "max_political_score": { "type": "number" },
      "min_america_first_score": { "type": "number" },
      "max_america_first_score": { "type": "number" },
      "sort_by": {
        "type": "string",
        "enum": ["ticker", "fundamental_constriction_score", "net_exposure_score", "insider_conviction_score", "political_score", "america_first_score"]
      },
      "sort_dir": { "type": "string", "enum": ["asc", "desc"] }
    }
  }'::jsonb
WHERE tool_key = 'tool.screen.run';

UPDATE public.ai_tools SET
  input_schema_json = '{
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "description": { "type": "string" },
      "organization_client_id": { "type": "string", "format": "uuid" },
      "q": { "type": "string" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 500 },
      "min_fundamental_constriction_score": { "type": "number" },
      "max_fundamental_constriction_score": { "type": "number" },
      "min_net_exposure_score": { "type": "number" },
      "max_net_exposure_score": { "type": "number" },
      "min_insider_conviction_score": { "type": "number" },
      "max_insider_conviction_score": { "type": "number" },
      "min_political_score": { "type": "number" },
      "max_political_score": { "type": "number" },
      "min_america_first_score": { "type": "number" },
      "max_america_first_score": { "type": "number" }
    },
    "required": ["name"]
  }'::jsonb
WHERE tool_key = 'tool.watchlist.create_from_screen';
