CREATE INDEX IF NOT EXISTS ix_sc_security_taxonomy_asof
ON security_classifications (security_id, taxonomy_id, as_of_date DESC);

CREATE INDEX IF NOT EXISTS ix_sc_taxonomy_node_asof
ON security_classifications (taxonomy_node_id, as_of_date DESC);

CREATE INDEX IF NOT EXISTS ix_sc_asof_date
ON security_classifications (as_of_date DESC);
