PRAGMA defer_foreign_keys = ON;

-- Rebuild the related tables because SQLite rewrites the child foreign-key target
-- when the parent table is renamed.
ALTER TABLE endpoint_session_bindings RENAME TO endpoint_session_bindings_v156;
ALTER TABLE endpoint_instance_bindings RENAME TO endpoint_instance_bindings_v156;
ALTER TABLE endpoint_principals RENAME TO endpoint_principals_v156;

DROP INDEX idx_endpoint_session_bindings_endpoint;
DROP INDEX idx_endpoint_instance_bindings_principal;
DROP INDEX idx_endpoint_principals_active;

CREATE TABLE endpoint_principals (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK(kind IN ('web', 'desktop', 'mobile', 'browser')),
  display_name TEXT NOT NULL,
  platform     TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);

CREATE TABLE endpoint_instance_bindings (
  endpoint_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES endpoint_principals(id),
  bound_at INTEGER NOT NULL
);

CREATE TABLE endpoint_session_bindings (
  session_key TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES endpoint_instance_bindings(endpoint_id),
  bound_at INTEGER NOT NULL
);

INSERT INTO endpoint_principals SELECT * FROM endpoint_principals_v156;
INSERT INTO endpoint_instance_bindings SELECT * FROM endpoint_instance_bindings_v156;
INSERT INTO endpoint_session_bindings SELECT * FROM endpoint_session_bindings_v156;

DROP TABLE endpoint_session_bindings_v156;
DROP TABLE endpoint_instance_bindings_v156;
DROP TABLE endpoint_principals_v156;

CREATE INDEX idx_endpoint_principals_active
  ON endpoint_principals(kind, last_seen_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_endpoint_instance_bindings_principal
  ON endpoint_instance_bindings(principal_id);
CREATE INDEX idx_endpoint_session_bindings_endpoint
  ON endpoint_session_bindings(endpoint_id);
