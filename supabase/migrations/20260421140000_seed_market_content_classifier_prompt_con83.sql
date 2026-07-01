-- CON-53 + CON-83 / CON-84 / CON-85
--
-- Section A (CON-53): DDL aligned with Docs/events_news.sql.txt — public.market_content,
-- public.market_content_entities, indexes, triggers, comments.
-- Section B (CON-83): Seed formula + prompts + prompt_versions (CON-84 system, CON-85 user template).
--
-- Runtime contract: alpha-galangal-rest-api/src/market-content/market-content-classifier.contract.ts

-- =========================================================
-- A) updated_at helper (same body as multi-tenant migration; idempotent)
-- =========================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- B) market_content (canonical news / events / filings row)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.market_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source text NOT NULL,
  content_type text NOT NULL,
  category text,

  title text,
  summary text,
  url text,

  published_at timestamptz,
  occurred_at timestamptz,

  raw jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_content IS
'Canonical storage for normalized market content across providers.';

COMMENT ON COLUMN public.market_content.source IS
'Origin of the item such as fmp, llm, or manual.';

COMMENT ON COLUMN public.market_content.content_type IS
'Normalized item type such as news, press_release, earnings, filing, or economic.';

COMMENT ON COLUMN public.market_content.category IS
'Theme classification such as regulatory, management, product, macro, financial, etc.';

DROP TRIGGER IF EXISTS trg_market_content_updated_at ON public.market_content;
CREATE TRIGGER trg_market_content_updated_at
  BEFORE UPDATE ON public.market_content
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

-- =========================================================
-- C) market_content_entities (per-entity interpretation)
-- =========================================================

CREATE TABLE IF NOT EXISTS public.market_content_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  market_content_id uuid NOT NULL
    REFERENCES public.market_content(id)
    ON DELETE CASCADE,

  entity_id uuid NOT NULL
    REFERENCES public.entities(id)
    ON DELETE CASCADE,

  is_primary boolean NOT NULL DEFAULT true,

  polarity smallint,
  severity numeric(5, 4),
  confidence numeric(5, 4),

  should_display boolean NOT NULL DEFAULT true,
  display_reason text,
  materiality_score numeric(5, 4),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT unique_market_content_entity UNIQUE (market_content_id, entity_id),

  CONSTRAINT polarity_valid
    CHECK (polarity IN (-1, 0, 1) OR polarity IS NULL),

  CONSTRAINT severity_valid
    CHECK (severity IS NULL OR severity BETWEEN 0 AND 1),

  CONSTRAINT confidence_valid
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),

  CONSTRAINT materiality_score_valid
    CHECK (materiality_score IS NULL OR materiality_score BETWEEN 0 AND 1)
);

COMMENT ON TABLE public.market_content_entities IS
'Links normalized content rows to entities and stores entity-specific interpretation.';

COMMENT ON COLUMN public.market_content_entities.polarity IS
'Direction of impact for this entity: -1 negative, 0 neutral, 1 positive.';

COMMENT ON COLUMN public.market_content_entities.severity IS
'Impact magnitude for this entity from 0 (minor) to 1 (severe).';

COMMENT ON COLUMN public.market_content_entities.should_display IS
'Whether this content item should be shown to users for this entity.';

COMMENT ON COLUMN public.market_content_entities.display_reason IS
'Short explanation for why the item should or should not be displayed for this entity.';

COMMENT ON COLUMN public.market_content_entities.materiality_score IS
'Overall importance of this item for this entity from 0 to 1.';

DROP TRIGGER IF EXISTS trg_market_content_entities_updated_at ON public.market_content_entities;
CREATE TRIGGER trg_market_content_entities_updated_at
  BEFORE UPDATE ON public.market_content_entities
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

-- =========================================================
-- D) indexes (from Docs/events_news.sql.txt)
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_market_content_content_type
  ON public.market_content(content_type);

CREATE INDEX IF NOT EXISTS idx_market_content_category
  ON public.market_content(category);

CREATE INDEX IF NOT EXISTS idx_market_content_published_at
  ON public.market_content(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_content_occurred_at
  ON public.market_content(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_content_source
  ON public.market_content(source);

CREATE INDEX IF NOT EXISTS idx_market_content_entities_entity_id
  ON public.market_content_entities(entity_id);

CREATE INDEX IF NOT EXISTS idx_market_content_entities_entity_polarity
  ON public.market_content_entities(entity_id, polarity);

CREATE INDEX IF NOT EXISTS idx_market_content_entities_entity_severity
  ON public.market_content_entities(entity_id, severity DESC);

CREATE INDEX IF NOT EXISTS idx_market_content_entities_entity_should_display
  ON public.market_content_entities(entity_id, should_display);

CREATE INDEX IF NOT EXISTS idx_market_content_entities_entity_materiality
  ON public.market_content_entities(entity_id, materiality_score DESC);

-- =========================================================
-- E) CON-83 seed: formula + prompts + prompt_versions
-- =========================================================

DO $$
DECLARE
  v_org_id uuid;
  v_cat_id uuid;
  v_formula_id uuid;
  v_prompt_id uuid;
  v_pv_id uuid;
  v_schema jsonb := jsonb_build_object(
    'type', 'object',
    'description', 'LLM output mapped to public.market_content + public.market_content_entities (see migration header).',
    'required', jsonb_build_array('market_content', 'market_content_entities'),
    'properties', jsonb_build_object(
      'market_content', jsonb_build_object(
        'type', 'object',
        'description', 'Normalized row for public.market_content (raw jsonb is filled by ingestion, not the LLM).',
        'required', jsonb_build_array(
          'source', 'content_type', 'category', 'title', 'summary', 'url', 'published_at', 'occurred_at'
        ),
        'properties', jsonb_build_object(
          'source', jsonb_build_object(
            'type', 'string',
            'description', 'public.market_content.source NOT NULL (e.g. fmp, llm, manual).'
          ),
          'content_type', jsonb_build_object(
            'type', 'string',
            'description', 'public.market_content.content_type NOT NULL (e.g. news, press_release, earnings).'
          ),
          'category', jsonb_build_object(
            'type', jsonb_build_array('string', 'null'),
            'description', 'public.market_content.category (nullable).'
          ),
          'title', jsonb_build_object(
            'type', jsonb_build_array('string', 'null'),
            'description', 'public.market_content.title.'
          ),
          'summary', jsonb_build_object(
            'type', jsonb_build_array('string', 'null'),
            'description', 'public.market_content.summary.'
          ),
          'url', jsonb_build_object(
            'type', jsonb_build_array('string', 'null'),
            'description', 'public.market_content.url.'
          ),
          'published_at', jsonb_build_object(
            'type', jsonb_build_array('string', 'null'),
            'description', 'ISO-8601 timestamptz string for public.market_content.published_at (nullable).'
          ),
          'occurred_at', jsonb_build_object(
            'type', jsonb_build_array('string', 'null'),
            'description', 'ISO-8601 timestamptz string for public.market_content.occurred_at (nullable).'
          )
        )
      ),
      'market_content_entities', jsonb_build_object(
        'type', 'array',
        'minItems', 1,
        'description', 'Rows for public.market_content_entities; entity_identifier is resolved to entities.id before insert.',
        'items', jsonb_build_object(
          'type', 'object',
          'required', jsonb_build_array(
            'entity_identifier', 'is_primary', 'polarity', 'severity', 'confidence',
            'should_display', 'display_reason', 'materiality_score'
          ),
          'properties', jsonb_build_object(
            'entity_identifier', jsonb_build_object(
              'type', 'string',
              'description', 'Must match an entry in the candidate list; ingestion resolves to public.market_content_entities.entity_id.'
            ),
            'is_primary', jsonb_build_object(
              'type', 'boolean',
              'description', 'public.market_content_entities.is_primary (at most one true per content item).'
            ),
            'polarity', jsonb_build_object(
              'type', jsonb_build_array('integer', 'null'),
              'description', 'public.market_content_entities.polarity smallint: -1, 0, 1, or null.'
            ),
            'severity', jsonb_build_object(
              'type', jsonb_build_array('number', 'null'),
              'description', 'public.market_content_entities.severity numeric(5,4) in [0,1] or null.'
            ),
            'confidence', jsonb_build_object(
              'type', jsonb_build_array('number', 'null'),
              'description', 'public.market_content_entities.confidence numeric(5,4) in [0,1] or null.'
            ),
            'should_display', jsonb_build_object(
              'type', 'boolean',
              'description', 'public.market_content_entities.should_display NOT NULL.'
            ),
            'display_reason', jsonb_build_object(
              'type', jsonb_build_array('string', 'null'),
              'description', 'public.market_content_entities.display_reason.'
            ),
            'materiality_score', jsonb_build_object(
              'type', jsonb_build_array('number', 'null'),
              'description', 'public.market_content_entities.materiality_score numeric(5,4) in [0,1] or null.'
            )
          )
        )
      )
    )
  );
  v_system text := $sys$
You are a financial market content classifier.

Your job is to read one market-related content item and return normalized structured output for database storage and entity-specific display decisions.

Be conservative.

Do not invent facts.

If something is unclear, use null (except for fields documented as NOT NULL below).

Return valid JSON only.

Do not include markdown, comments, or explanation outside the JSON.

You must produce:

1. one market_content object
2. one or more market_content_entities objects

Persistence mapping (PostgreSQL):

- public.market_content stores canonical content. Your JSON keys map directly to columns:
  source, content_type, category, title, summary, url, published_at, occurred_at.
- source and content_type are NOT NULL in the database: always return non-empty strings (use "fmp" for Financial Modeling Prep ingestion when appropriate).
- published_at and occurred_at should be ISO-8601 strings or null; the pipeline casts them to timestamptz.
- public.market_content.raw is jsonb NOT NULL default '{}': the ingestion layer fills this from the provider payload; you do not output raw in JSON.

- public.market_content_entities stores one row per entity. The database column entity_id is a UUID foreign key to public.entities.id.
- Your JSON uses entity_identifier strings that must match the candidate list in the user prompt. The ingestion layer resolves each identifier to entity_id before insert.
- is_primary, polarity, severity, confidence, should_display, display_reason, materiality_score map to columns of the same names. At most one entity row should have is_primary true when multiple entities are returned.

Definitions:

* category describes the theme of the content itself.
* polarity describes the direction of impact for a specific entity.
* severity describes the magnitude of impact on a specific entity from 0.0 to 1.0.
* confidence describes your confidence in the entity-specific classification from 0.0 to 1.0.
* materiality_score describes how important this content is for a user reviewing this entity from 0.0 to 1.0.
* should_display describes whether this item should be shown to users for that entity.

Allowed category values:

* financial
* regulatory
* legal
* management
* product
* macro
* industry
* capital_markets
* earnings
* guidance
* analyst

Allowed polarity values:

* -1
* 0
* 1

Severity guidance:

* 0.0 to 0.2 = minor
* 0.2 to 0.4 = low
* 0.4 to 0.6 = medium
* 0.6 to 0.8 = high
* 0.8 to 1.0 = very severe

Materiality guidance:

* 0.0 to 0.2 = low importance
* 0.2 to 0.4 = modest importance
* 0.4 to 0.6 = meaningful
* 0.6 to 0.8 = high importance
* 0.8 to 1.0 = very high importance

should_display guidance:

Set should_display = true when the item is materially relevant, informative, and useful for users reviewing recent events for the entity.

Set should_display = false when the item is trivial, repetitive, weakly related, low-signal, or not useful enough to surface.

Examples:

* major earnings miss for the company: usually should_display = true
* CEO resignation: usually should_display = true
* SEC or regulatory probe: usually should_display = true
* routine low-signal analyst mention: often should_display = false
* generic industry article with only weak mention of the entity: often should_display = false

Use category based on what the content is mainly about, not the source format.

Examples:

* earnings miss article to earnings or financial
* CEO resignation to management
* SEC investigation to regulatory or legal
* product launch to product
* Fed decision to macro

Return this JSON shape exactly (concrete values in your response; follow NOT NULL rules above):

{
  "market_content": {
    "source": "fmp",
    "content_type": "news",
    "category": null,
    "title": null,
    "summary": null,
    "url": null,
    "published_at": null,
    "occurred_at": null
  },
  "market_content_entities": [
    {
      "entity_identifier": "EXAMPLE_TICKER_OR_ID_FROM_CANDIDATE_LIST",
      "is_primary": true,
      "polarity": null,
      "severity": null,
      "confidence": null,
      "should_display": true,
      "display_reason": null,
      "materiality_score": null
    }
  ]
}
$sys$;
  v_user text := $usr$
Classify the following market content item.

Source: {{source}}

Content type: {{content_type}}

Title: {{title}}

Summary: {{summary}}

Body: {{body}}

URL: {{url}}

Published at: {{published_at}}

Occurred at: {{occurred_at}}

Candidate entities:

{{entity_list}}

Instructions:

* Only include entities from the candidate entity list if they are actually relevant.
* Mark one entity as primary when appropriate.
* Set should_display for each entity based on whether this item is worth surfacing to users for that entity.
* Return valid JSON only.
$usr$;
BEGIN
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE NOTICE 'seed_market_content_classifier_con83: no organizations; skip';
    RETURN;
  END IF;

  SELECT id INTO v_cat_id
  FROM public.signal_categories
  WHERE organization_id = v_org_id AND name = 'BUSINESS_QUALITY'
  LIMIT 1;

  IF v_cat_id IS NULL THEN
    SELECT id INTO v_cat_id
    FROM public.signal_categories
    WHERE organization_id = v_org_id
    ORDER BY name
    LIMIT 1;
  END IF;

  INSERT INTO public.formulas (
    organization_id,
    category_id,
    key,
    name,
    output_type,
    definition,
    display_formula,
    description,
    visibility,
    formula_level,
    execution_type,
    version,
    is_active
  )
  VALUES (
    v_org_id,
    v_cat_id,
    'market_content_classifier',
    'Market content classifier (events/news)',
    'json',
    jsonb_build_object('type', 'llm', 'role', 'market_content_classifier'),
    'LLM JSON: market_content + market_content_entities',
    'Classifies a single news or event item into public.market_content / public.market_content_entities (CON-53 DDL in this migration).',
    'organization',
    'MASTER_MODEL',
    'llm',
    1,
    true
  )
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        output_type = EXCLUDED.output_type,
        definition = EXCLUDED.definition,
        display_formula = EXCLUDED.display_formula,
        description = EXCLUDED.description,
        updated_at = now()
  RETURNING id INTO v_formula_id;

  IF v_formula_id IS NULL THEN
    SELECT id INTO v_formula_id
    FROM public.formulas
    WHERE key = 'market_content_classifier'
    LIMIT 1;
  END IF;

  INSERT INTO public.prompts (organization_id, key, category, name, description)
  VALUES (
    v_org_id,
    'market_content_classifier',
    'formula',
    'Market content classifier',
    'CON-83: editable system (CON-84) and user (CON-85) prompts; persists to public.market_content* (DDL in this migration).'
  )
  ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now()
  RETURNING id INTO v_prompt_id;

  IF v_prompt_id IS NULL THEN
    SELECT id INTO v_prompt_id
    FROM public.prompts
    WHERE key = 'market_content_classifier'
    LIMIT 1;
  END IF;

  INSERT INTO public.prompt_versions (
    organization_id,
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
    max_output_tokens
  )
  SELECT
    v_org_id,
    v_prompt_id,
    1,
    'active',
    v_system,
    v_user,
    v_schema,
    'CON-83 seed; output_schema aligned to Docs/events_news.sql.txt (public.market_content, public.market_content_entities).',
    'gemini-2.0-flash',
    0.2,
    NULL,
    8192
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.prompt_versions pv
    WHERE pv.prompt_id = v_prompt_id
      AND pv.version = 1
  )
  RETURNING id INTO v_pv_id;

  IF v_pv_id IS NULL THEN
    SELECT id INTO v_pv_id
    FROM public.prompt_versions
    WHERE prompt_id = v_prompt_id
      AND version = 1
    LIMIT 1;
  END IF;

  UPDATE public.prompts
  SET active_prompt_version_id = v_pv_id,
      updated_at = now()
  WHERE id = v_prompt_id;
END $$;
