CREATE TABLE endpoint_session_bindings (
  session_key TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES endpoint_instance_bindings(endpoint_id),
  bound_at INTEGER NOT NULL
);

CREATE INDEX idx_endpoint_session_bindings_endpoint
  ON endpoint_session_bindings(endpoint_id);
