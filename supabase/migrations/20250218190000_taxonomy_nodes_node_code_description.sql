BEGIN;

-- 1) Add GICS code + description fields (if they don't exist)
ALTER TABLE taxonomy_nodes
  ADD COLUMN IF NOT EXISTS node_code TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 2) Optional: rename name -> title (only if you currently have "name")
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'taxonomy_nodes'
      AND column_name = 'name'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'taxonomy_nodes'
      AND column_name = 'title'
  )
  THEN
    EXECUTE 'ALTER TABLE taxonomy_nodes RENAME COLUMN name TO title';
  END IF;
END $$;

-- 3) Enforce node_code rules (digits only, not blank) but allow NULL while you backfill
ALTER TABLE taxonomy_nodes
  DROP CONSTRAINT IF EXISTS taxonomy_nodes_node_code_digits_only,
  ADD CONSTRAINT taxonomy_nodes_node_code_digits_only
    CHECK (node_code IS NULL OR node_code ~ '^[0-9]+$');

ALTER TABLE taxonomy_nodes
  DROP CONSTRAINT IF EXISTS taxonomy_nodes_node_code_not_blank,
  ADD CONSTRAINT taxonomy_nodes_node_code_not_blank
    CHECK (node_code IS NULL OR btrim(node_code) <> '');

COMMIT;
