CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_taxonomy_nodes_taxonomy_code
ON taxonomy_nodes (taxonomy_id, node_code)
WHERE node_code IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_taxonomy_nodes_parent
ON taxonomy_nodes (taxonomy_id, parent_node_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_taxonomy_nodes_level
ON taxonomy_nodes (taxonomy_id, level);
