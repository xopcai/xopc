CREATE TABLE IF NOT EXISTS connector_approvals (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  connection_id TEXT REFERENCES connector_connections(id) ON DELETE SET NULL,
  agent_id TEXT,
  session_key TEXT,
  action_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write', 'admin')),
  arguments_hash TEXT NOT NULL,
  arguments_preview_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_connector_approvals_pending
  ON connector_approvals(principal_id, status, expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_approvals_session
  ON connector_approvals(session_key, status, created_at DESC);
