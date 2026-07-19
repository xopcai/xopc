CREATE TABLE IF NOT EXISTS connector_catalog_entries (
  connector_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_connector_catalog_provider
  ON connector_catalog_entries(provider, fetched_at DESC);

CREATE TABLE IF NOT EXISTS connector_installations (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  allowed_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  max_scope TEXT NOT NULL DEFAULT 'read' CHECK (max_scope IN ('read', 'write', 'admin')),
  confirmation_policy TEXT NOT NULL DEFAULT 'writes'
    CHECK (confirmation_policy IN ('always', 'writes', 'admin', 'never')),
  selected_connection_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_id, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_installations_principal
  ON connector_installations(principal_id, enabled, connector_id);

CREATE TABLE IF NOT EXISTS connector_connections (
  id TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES connector_installations(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  alias TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('pending', 'active', 'expired', 'failed', 'revoked', 'disabled', 'unknown')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  connected_at TEXT,
  expires_at TEXT,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_connection_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_connections_principal
  ON connector_connections(principal_id, connector_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_connections_default
  ON connector_connections(principal_id, connector_id)
  WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS connector_action_metadata (
  connector_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  toolkit TEXT,
  scope TEXT NOT NULL DEFAULT 'write' CHECK (scope IN ('read', 'write', 'admin')),
  curated INTEGER NOT NULL DEFAULT 0 CHECK (curated IN (0, 1)),
  input_schema_json TEXT,
  schema_version TEXT,
  cached_at TEXT NOT NULL,
  PRIMARY KEY(connector_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_action_scope
  ON connector_action_metadata(connector_id, scope, curated);

CREATE TABLE IF NOT EXISTS connector_execution_audit (
  id TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES connector_installations(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES connector_connections(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  agent_id TEXT,
  session_key TEXT,
  action_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write', 'admin')),
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'confirmation_required')),
  result_status TEXT NOT NULL CHECK (result_status IN ('success', 'error', 'not_executed')),
  duration_ms INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connector_audit_principal_time
  ON connector_execution_audit(principal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_audit_connector_time
  ON connector_execution_audit(connector_id, created_at DESC);
