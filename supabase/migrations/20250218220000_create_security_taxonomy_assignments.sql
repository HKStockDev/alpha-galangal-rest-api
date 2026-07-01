BEGIN;

CREATE TABLE IF NOT EXISTS security_taxonomy_assignments (
  security_taxonomy_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  security_id uuid NOT NULL,
  taxonomy_id uuid NOT NULL,

  -- Leaf assignment (usually sub_industry). Parents inferred via parent_node_id chain.
  taxonomy_node_id uuid NOT NULL,

  -- Provenance + quality
  source text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1.0,

  -- Time validity / backtesting
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_sta_security
    FOREIGN KEY (security_id) REFERENCES securities(id) ON DELETE CASCADE,

  CONSTRAINT fk_sta_taxonomy
    FOREIGN KEY (taxonomy_id) REFERENCES taxonomies(taxonomy_id) ON DELETE CASCADE,

  CONSTRAINT fk_sta_taxonomy_node
    FOREIGN KEY (taxonomy_node_id) REFERENCES taxonomy_nodes(node_id) ON DELETE RESTRICT,

  -- Keep source controlled (extend list as you like)
  CONSTRAINT sta_source_allowed
    CHECK (source IN ('sic_map', 'vendor', 'manual', 'llm_assisted', 'computed')),

  CONSTRAINT sta_confidence_range
    CHECK (confidence >= 0 AND confidence <= 1),

  -- Prevent duplicate "same assignment same day"
  CONSTRAINT sta_unique_assignment_per_day
    UNIQUE (security_id, taxonomy_id, taxonomy_node_id, as_of_date)
);

COMMIT;
