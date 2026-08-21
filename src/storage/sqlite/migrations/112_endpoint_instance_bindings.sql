CREATE TABLE endpoint_instance_bindings (
  endpoint_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES endpoint_principals(id),
  bound_at INTEGER NOT NULL
);

CREATE INDEX idx_endpoint_instance_bindings_principal
  ON endpoint_instance_bindings(principal_id);
