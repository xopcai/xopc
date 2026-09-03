CREATE TABLE execution_hosts (
  host_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  app_version TEXT NOT NULL,
  public_key TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  max_concurrency INTEGER NOT NULL CHECK (max_concurrency BETWEEN 1 AND 64),
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'draining', 'revoked')),
  credential_epoch INTEGER NOT NULL DEFAULT 1 CHECK (credential_epoch > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX idx_execution_hosts_lifecycle_seen
  ON execution_hosts(lifecycle_status, last_seen_at DESC);

CREATE TABLE execution_host_events (
  event_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES execution_hosts(host_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_execution_host_events_host
  ON execution_host_events(host_id, created_at DESC);
