BEGIN;

-- =========================
-- EXPOSURES DICTIONARY
-- =========================
CREATE TABLE IF NOT EXISTS exposures (
  exposure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  name text NOT NULL,
  slug text NOT NULL,
  category text NOT NULL,           -- e.g. macro, demand_driver, supply_chain, regulatory
  description text,

  is_active boolean NOT NULL DEFAULT true,
  sort_order integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT exposures_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT exposures_slug_not_blank CHECK (btrim(slug) <> ''),
  CONSTRAINT exposures_category_not_blank CHECK (btrim(category) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_exposures_name ON exposures (name);
CREATE UNIQUE INDEX IF NOT EXISTS ux_exposures_slug ON exposures (slug);

-- =========================
-- SECURITY_EXPOSURES (JOIN + METADATA)
-- =========================
CREATE TABLE IF NOT EXISTS security_exposures (
  security_exposure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  security_id uuid NOT NULL,
  exposure_id uuid NOT NULL,

  direction text NOT NULL,          -- beneficiary | dependent | supplier | customer
  strength numeric(6,5) NOT NULL DEFAULT 0.00000,  -- 0..1

  source text NOT NULL DEFAULT 'manual',           -- rules | llm | manual | computed
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000, -- 0..1

  evidence text,
  model_version text,
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_security_exposures_security
    FOREIGN KEY (security_id)
    REFERENCES securities(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_security_exposures_exposure
    FOREIGN KEY (exposure_id)
    REFERENCES exposures(exposure_id)
    ON DELETE CASCADE,

  CONSTRAINT security_exposures_direction_allowed
    CHECK (direction IN ('beneficiary', 'dependent', 'supplier', 'customer')),

  CONSTRAINT security_exposures_strength_range
    CHECK (strength >= 0 AND strength <= 1),

  CONSTRAINT security_exposures_source_allowed
    CHECK (source IN ('rules', 'llm', 'manual', 'computed')),

  CONSTRAINT security_exposures_confidence_range
    CHECK (confidence >= 0 AND confidence <= 1),

  CONSTRAINT security_exposures_unique_per_day
    UNIQUE (security_id, exposure_id, direction, as_of_date)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS ix_security_exposures_security_asof
ON security_exposures (security_id, as_of_date DESC);

CREATE INDEX IF NOT EXISTS ix_security_exposures_exposure_asof
ON security_exposures (exposure_id, as_of_date DESC);

CREATE INDEX IF NOT EXISTS ix_security_exposures_direction
ON security_exposures (direction);

COMMIT;
