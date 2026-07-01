UPDATE taxonomy_nodes
SET code = node_code
WHERE node_code IS NOT NULL;

ALTER TABLE taxonomy_nodes
  DROP CONSTRAINT IF EXISTS taxonomy_nodes_node_code_digits_only,
  DROP CONSTRAINT IF EXISTS taxonomy_nodes_node_code_not_blank;

DROP INDEX IF EXISTS ux_taxonomy_nodes_taxonomy_code;

ALTER TABLE taxonomy_nodes
  DROP COLUMN IF EXISTS node_code;

ALTER TABLE taxonomy_nodes
  ADD CONSTRAINT taxonomy_nodes_code_digits_only
    CHECK (code IS NULL OR code ~ '^[0-9]+$');

ALTER TABLE taxonomy_nodes
  ADD CONSTRAINT taxonomy_nodes_code_not_blank
    CHECK (code IS NULL OR btrim(code) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS ux_taxonomy_nodes_taxonomy_code
  ON taxonomy_nodes (taxonomy_id, code)
  WHERE code IS NOT NULL;
