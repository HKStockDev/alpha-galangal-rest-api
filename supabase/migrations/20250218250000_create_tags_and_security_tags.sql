BEGIN;

-- =========================
-- TAGS DICTIONARY
-- =========================
CREATE TABLE IF NOT EXISTS tags (
  tag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  name text NOT NULL,
  slug text NOT NULL,
  "group" text NOT NULL,

  description text,
  is_active boolean NOT NULL DEFAULT true,
  is_llm_assignable boolean NOT NULL DEFAULT true,
  sort_order integer,
  weight_hint numeric(10,6),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tags_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT tags_slug_not_blank CHECK (btrim(slug) <> ''),
  CONSTRAINT tags_group_not_blank CHECK (btrim("group") <> '')
);

-- Uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS ux_tags_name ON tags (name);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tags_slug ON tags (slug);

-- =========================
-- SECURITY_TAGS (JOIN + METADATA)
-- =========================
CREATE TABLE IF NOT EXISTS security_tags (
  security_tag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  security_id uuid NOT NULL,
  tag_id uuid NOT NULL,

  source text NOT NULL DEFAULT 'manual',
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,
  evidence text,
  model_version text,
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_security_tags_security
    FOREIGN KEY (security_id)
    REFERENCES securities(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_security_tags_tag
    FOREIGN KEY (tag_id)
    REFERENCES tags(tag_id)
    ON DELETE CASCADE,

  CONSTRAINT security_tags_source_allowed
    CHECK (source IN ('rules', 'llm', 'manual', 'computed')),

  CONSTRAINT security_tags_confidence_range
    CHECK (confidence >= 0 AND confidence <= 1),

  CONSTRAINT security_tags_unique_per_day
    UNIQUE (security_id, tag_id, as_of_date)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS ix_security_tags_security_asof
ON security_tags (security_id, as_of_date DESC);

CREATE INDEX IF NOT EXISTS ix_security_tags_tag_asof
ON security_tags (tag_id, as_of_date DESC);

COMMIT;
