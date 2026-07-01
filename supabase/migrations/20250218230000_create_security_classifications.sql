BEGIN;

CREATE TABLE IF NOT EXISTS security_classifications (
  security_classification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  security_id uuid NOT NULL,
  taxonomy_id uuid NOT NULL,
  taxonomy_node_id uuid NOT NULL,

  -- provenance
  source text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 1.0000,

  -- time validity (for backtesting)
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_sc_security
    FOREIGN KEY (security_id)
    REFERENCES securities(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_sc_taxonomy
    FOREIGN KEY (taxonomy_id)
    REFERENCES taxonomies(taxonomy_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_sc_taxonomy_node
    FOREIGN KEY (taxonomy_node_id)
    REFERENCES taxonomy_nodes(node_id)
    ON DELETE RESTRICT,

  CONSTRAINT sc_source_allowed
    CHECK (source IN ('sic_map', 'vendor', 'manual', 'llm_assisted', 'computed')),

  CONSTRAINT sc_confidence_range
    CHECK (confidence >= 0 AND confidence <= 1),

  CONSTRAINT sc_unique_per_day
    UNIQUE (security_id, taxonomy_id, taxonomy_node_id, as_of_date)
);

COMMIT;
