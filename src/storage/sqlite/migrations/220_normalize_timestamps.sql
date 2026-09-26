CREATE TABLE sessions_next (
  conversation_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  active_transcript_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  name TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  session_started_at INTEGER,
  last_interaction_at INTEGER,
  source_channel TEXT NOT NULL DEFAULT '',
  source_chat_id TEXT NOT NULL DEFAULT '',
  session_type TEXT,
  hidden_from_session_list INTEGER NOT NULL DEFAULT 0,
  parent_conversation_id TEXT,
  workflow_run_id TEXT,
  workflow_definition_id TEXT,
  workflow_agent_id TEXT,
  workflow_agent_label TEXT,
  routing_json TEXT,
  custom_data_json TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  compacted_count INTEGER NOT NULL DEFAULT 0,
  last_flushed_at INTEGER,
  flush_count INTEGER NOT NULL DEFAULT 0,
  thinking_level TEXT,
  verbose_level TEXT,
  project_id TEXT
);
INSERT INTO sessions_next SELECT
  conversation_id, agent_id, active_transcript_id, status, name, tags_json, created_at,
  updated_at, last_accessed_at, session_started_at, last_interaction_at, source_channel,
  source_chat_id, session_type, hidden_from_session_list, parent_conversation_id,
  workflow_run_id, workflow_definition_id, workflow_agent_id, workflow_agent_label,
  routing_json, custom_data_json, message_count, estimated_tokens, compacted_count,
  CASE WHEN last_flushed_at IS NULL THEN NULL
    WHEN typeof(last_flushed_at) IN ('integer', 'real') THEN CAST(last_flushed_at AS INTEGER)
    ELSE CAST(ROUND((julianday(last_flushed_at) - 2440587.5) * 86400000) AS INTEGER) END,
  flush_count, thinking_level, verbose_level, project_id
FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_next RENAME TO sessions;
CREATE INDEX idx_sessions_agent_updated ON sessions(agent_id, updated_at DESC);
CREATE INDEX idx_sessions_last_interaction ON sessions(last_interaction_at DESC);
CREATE INDEX idx_sessions_parent ON sessions(parent_conversation_id);
CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at DESC);
CREATE INDEX idx_sessions_source_channel ON sessions(source_channel);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_type ON sessions(session_type);
CREATE INDEX idx_sessions_workflow_run ON sessions(workflow_run_id);

CREATE TABLE connector_catalog_entries_next (
  connector_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER
);
INSERT INTO connector_catalog_entries_next SELECT
  connector_id, provider, definition_json,
  CASE WHEN typeof(fetched_at) IN ('integer', 'real') THEN CAST(fetched_at AS INTEGER)
    ELSE CAST(ROUND((julianday(fetched_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN expires_at IS NULL THEN NULL
    WHEN typeof(expires_at) IN ('integer', 'real') THEN CAST(expires_at AS INTEGER)
    ELSE CAST(ROUND((julianday(expires_at) - 2440587.5) * 86400000) AS INTEGER) END
FROM connector_catalog_entries;
DROP TABLE connector_catalog_entries;
ALTER TABLE connector_catalog_entries_next RENAME TO connector_catalog_entries;
CREATE INDEX idx_connector_catalog_provider ON connector_catalog_entries(provider, fetched_at DESC);

CREATE TABLE connector_installations_next (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  allowed_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  max_scope TEXT NOT NULL DEFAULT 'read' CHECK(max_scope IN ('read', 'write', 'admin')),
  confirmation_policy TEXT NOT NULL DEFAULT 'writes'
    CHECK(confirmation_policy IN ('always', 'writes', 'admin', 'never')),
  selected_account_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(connector_id, principal_id)
);
INSERT INTO connector_installations_next SELECT
  id, connector_id, principal_id, enabled, allowed_agent_ids_json, max_scope,
  confirmation_policy, selected_account_ids_json,
  CASE WHEN typeof(created_at) IN ('integer', 'real') THEN CAST(created_at AS INTEGER)
    ELSE CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN typeof(updated_at) IN ('integer', 'real') THEN CAST(updated_at AS INTEGER)
    ELSE CAST(ROUND((julianday(updated_at) - 2440587.5) * 86400000) AS INTEGER) END
FROM connector_installations;
DROP TABLE connector_installations;
ALTER TABLE connector_installations_next RENAME TO connector_installations;
CREATE INDEX idx_connector_installations_principal
  ON connector_installations(principal_id, enabled, connector_id);

CREATE TABLE connector_accounts_next (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  identity_key TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  current_connection_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  allowed_agent_ids_json TEXT,
  backend_id TEXT,
  runtime_instance_id TEXT
);
INSERT INTO connector_accounts_next SELECT
  id, connector_id, principal_id, identity_key, identity_json, current_connection_id,
  CASE WHEN typeof(created_at) IN ('integer', 'real') THEN CAST(created_at AS INTEGER)
    ELSE CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN typeof(updated_at) IN ('integer', 'real') THEN CAST(updated_at AS INTEGER)
    ELSE CAST(ROUND((julianday(updated_at) - 2440587.5) * 86400000) AS INTEGER) END,
  label, enabled, allowed_agent_ids_json, backend_id, runtime_instance_id
FROM connector_accounts;
DROP TABLE connector_accounts;
ALTER TABLE connector_accounts_next RENAME TO connector_accounts;
CREATE UNIQUE INDEX idx_cli_account_identity
  ON connector_accounts(principal_id, runtime_instance_id, identity_key)
  WHERE runtime_instance_id IS NOT NULL AND identity_key IS NOT NULL;
CREATE UNIQUE INDEX idx_connector_accounts_identity
  ON connector_accounts(principal_id, backend_id, connector_id, identity_key)
  WHERE identity_key IS NOT NULL;

CREATE TABLE connector_connections_next (
  id TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES connector_installations(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  alias TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(status IN ('pending', 'active', 'expired', 'failed', 'revoked', 'disabled', 'unknown')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  connected_at INTEGER,
  expires_at INTEGER,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE
);
INSERT INTO connector_connections_next SELECT
  id, installation_id, connector_id, provider, principal_id, provider_connection_id,
  alias, identity_json, status, is_default,
  CASE WHEN connected_at IS NULL THEN NULL
    WHEN typeof(connected_at) IN ('integer', 'real') THEN CAST(connected_at AS INTEGER)
    ELSE CAST(ROUND((julianday(connected_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN expires_at IS NULL THEN NULL
    WHEN typeof(expires_at) IN ('integer', 'real') THEN CAST(expires_at AS INTEGER)
    ELSE CAST(ROUND((julianday(expires_at) - 2440587.5) * 86400000) AS INTEGER) END,
  last_error, metadata_json,
  CASE WHEN typeof(created_at) IN ('integer', 'real') THEN CAST(created_at AS INTEGER)
    ELSE CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN typeof(updated_at) IN ('integer', 'real') THEN CAST(updated_at AS INTEGER)
    ELSE CAST(ROUND((julianday(updated_at) - 2440587.5) * 86400000) AS INTEGER) END,
  account_id
FROM connector_connections;
DROP TABLE connector_connections;
ALTER TABLE connector_connections_next RENAME TO connector_connections;
CREATE INDEX idx_connector_connections_account ON connector_connections(account_id);
CREATE INDEX idx_connector_connections_principal
  ON connector_connections(principal_id, connector_id, status);
CREATE UNIQUE INDEX idx_connector_connections_provider_backend
  ON connector_connections(provider, COALESCE(json_extract(metadata_json, '$.backendId'), ''), provider_connection_id);

CREATE TABLE connector_action_metadata_next (
  connector_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  toolkit TEXT,
  scope TEXT NOT NULL DEFAULT 'write' CHECK(scope IN ('read', 'write', 'admin')),
  curated INTEGER NOT NULL DEFAULT 0 CHECK(curated IN (0, 1)),
  input_schema_json TEXT,
  schema_version TEXT,
  cached_at INTEGER NOT NULL,
  PRIMARY KEY(connector_id, action_id)
);
INSERT INTO connector_action_metadata_next SELECT
  connector_id, action_id, toolkit, scope, curated, input_schema_json, schema_version,
  CASE WHEN typeof(cached_at) IN ('integer', 'real') THEN CAST(cached_at AS INTEGER)
    ELSE CAST(ROUND((julianday(cached_at) - 2440587.5) * 86400000) AS INTEGER) END
FROM connector_action_metadata;
DROP TABLE connector_action_metadata;
ALTER TABLE connector_action_metadata_next RENAME TO connector_action_metadata;
CREATE INDEX idx_connector_action_scope
  ON connector_action_metadata(connector_id, scope, curated);

CREATE TABLE connector_execution_audit_next (
  id TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES connector_installations(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES connector_connections(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  agent_id TEXT,
  conversation_id TEXT,
  action_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('read', 'write', 'admin')),
  decision TEXT NOT NULL CHECK(decision IN ('allowed', 'denied', 'confirmation_required')),
  result_status TEXT NOT NULL CHECK(result_status IN ('success', 'error', 'not_executed')),
  duration_ms INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO connector_execution_audit_next SELECT
  id, installation_id, connection_id, connector_id, principal_id, agent_id,
  conversation_id, action_id, scope, decision, result_status, duration_ms, error_code,
  CASE WHEN typeof(created_at) IN ('integer', 'real') THEN CAST(created_at AS INTEGER)
    ELSE CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) END
FROM connector_execution_audit;
DROP TABLE connector_execution_audit;
ALTER TABLE connector_execution_audit_next RENAME TO connector_execution_audit;
CREATE INDEX idx_connector_audit_connector_time
  ON connector_execution_audit(connector_id, created_at DESC);
CREATE INDEX idx_connector_audit_principal_time
  ON connector_execution_audit(principal_id, created_at DESC);
CREATE INDEX idx_connector_execution_audit_connection
  ON connector_execution_audit(connection_id);
CREATE INDEX idx_connector_execution_audit_installation
  ON connector_execution_audit(installation_id);

CREATE TABLE connector_approvals_next (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  connection_id TEXT REFERENCES connector_connections(id) ON DELETE SET NULL,
  agent_id TEXT,
  conversation_id TEXT,
  action_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('read', 'write', 'admin')),
  arguments_hash TEXT NOT NULL,
  arguments_preview_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  consumed_at INTEGER,
  wait_id TEXT
);
INSERT INTO connector_approvals_next SELECT
  id, principal_id, connector_id, connection_id, agent_id, conversation_id, action_id,
  scope, arguments_hash, arguments_preview_json, status,
  CASE WHEN typeof(expires_at) IN ('integer', 'real') THEN CAST(expires_at AS INTEGER)
    ELSE CAST(ROUND((julianday(expires_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN typeof(created_at) IN ('integer', 'real') THEN CAST(created_at AS INTEGER)
    ELSE CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN decided_at IS NULL THEN NULL
    WHEN typeof(decided_at) IN ('integer', 'real') THEN CAST(decided_at AS INTEGER)
    ELSE CAST(ROUND((julianday(decided_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN consumed_at IS NULL THEN NULL
    WHEN typeof(consumed_at) IN ('integer', 'real') THEN CAST(consumed_at AS INTEGER)
    ELSE CAST(ROUND((julianday(consumed_at) - 2440587.5) * 86400000) AS INTEGER) END,
  wait_id
FROM connector_approvals;
DROP TABLE connector_approvals;
ALTER TABLE connector_approvals_next RENAME TO connector_approvals;
CREATE INDEX idx_connector_approvals_connection ON connector_approvals(connection_id);
CREATE INDEX idx_connector_approvals_pending
  ON connector_approvals(principal_id, status, expires_at, created_at DESC);
CREATE INDEX idx_connector_approvals_session
  ON connector_approvals(conversation_id, status, created_at DESC);

CREATE TABLE connector_webhook_deliveries_next (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('pending', 'processing', 'processed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL,
  processing_at INTEGER,
  processed_at INTEGER,
  last_error TEXT
);
INSERT INTO connector_webhook_deliveries_next SELECT
  id, provider, payload_hash, status, attempts,
  CASE WHEN typeof(received_at) IN ('integer', 'real') THEN CAST(received_at AS INTEGER)
    ELSE CAST(ROUND((julianday(received_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN processing_at IS NULL THEN NULL
    WHEN typeof(processing_at) IN ('integer', 'real') THEN CAST(processing_at AS INTEGER)
    ELSE CAST(ROUND((julianday(processing_at) - 2440587.5) * 86400000) AS INTEGER) END,
  CASE WHEN processed_at IS NULL THEN NULL
    WHEN typeof(processed_at) IN ('integer', 'real') THEN CAST(processed_at AS INTEGER)
    ELSE CAST(ROUND((julianday(processed_at) - 2440587.5) * 86400000) AS INTEGER) END,
  last_error
FROM connector_webhook_deliveries;
DROP TABLE connector_webhook_deliveries;
ALTER TABLE connector_webhook_deliveries_next RENAME TO connector_webhook_deliveries;
CREATE INDEX idx_connector_webhook_deliveries_status
  ON connector_webhook_deliveries(provider, status, received_at DESC);

CREATE TABLE user_trust_policies_next (
  principal_id TEXT PRIMARY KEY,
  default_action_level TEXT NOT NULL DEFAULT 'confirm'
    CHECK(default_action_level IN ('observe', 'suggest', 'confirm', 'auto')),
  updated_at INTEGER NOT NULL
);
INSERT INTO user_trust_policies_next SELECT
  principal_id, default_action_level,
  CASE WHEN typeof(updated_at) IN ('integer', 'real') THEN CAST(updated_at AS INTEGER)
    ELSE CAST(ROUND((julianday(updated_at) - 2440587.5) * 86400000) AS INTEGER) END
FROM user_trust_policies;
DROP TABLE user_trust_policies;
ALTER TABLE user_trust_policies_next RENAME TO user_trust_policies;

CREATE TABLE connector_backends_next (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('managed', 'byok')),
  label TEXT NOT NULL,
  credential_ref TEXT,
  credential_source TEXT NOT NULL DEFAULT 'stored'
    CHECK(credential_source IN ('stored', 'environment')),
  verified_at INTEGER,
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO connector_backends_next SELECT
  id, mode, label, credential_ref, credential_source,
  CASE WHEN verified_at IS NULL THEN NULL
    WHEN typeof(verified_at) IN ('integer', 'real') THEN CAST(verified_at AS INTEGER)
    ELSE CAST(ROUND((julianday(verified_at) - 2440587.5) * 86400000) AS INTEGER) END,
  active,
  CASE WHEN typeof(created_at) IN ('integer', 'real') THEN CAST(created_at AS INTEGER)
    ELSE CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) END
FROM connector_backends;
DROP TABLE connector_backends;
ALTER TABLE connector_backends_next RENAME TO connector_backends;
CREATE UNIQUE INDEX idx_connector_backend_active
  ON connector_backends(active) WHERE active = 1;
