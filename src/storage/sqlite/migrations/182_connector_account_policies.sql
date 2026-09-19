ALTER TABLE connector_installations RENAME COLUMN selected_connection_ids_json TO selected_account_ids_json;
UPDATE connector_installations
SET selected_account_ids_json = CASE
  WHEN json_array_length(selected_account_ids_json) = 0 THEN 'null'
  ELSE (
    SELECT json_group_array(DISTINCT c.account_id)
    FROM json_each(connector_installations.selected_account_ids_json) selected
    JOIN connector_connections c ON c.id = selected.value
    WHERE c.principal_id = connector_installations.principal_id
      AND c.connector_id = connector_installations.connector_id
      AND c.account_id IS NOT NULL
  )
END;

ALTER TABLE connector_accounts ADD COLUMN label TEXT;
ALTER TABLE connector_accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE connector_accounts ADD COLUMN allowed_agent_ids_json TEXT;
UPDATE connector_accounts SET label = (
  SELECT alias FROM connector_connections WHERE account_id = connector_accounts.id
  AND alias IS NOT NULL ORDER BY is_default DESC, updated_at DESC LIMIT 1
);

CREATE TABLE connector_backends (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('managed', 'byok')),
  label TEXT NOT NULL,
  credential_ref TEXT,
  credential_source TEXT NOT NULL DEFAULT 'stored' CHECK(credential_source IN ('stored','environment')),
  verified_at TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_connector_backend_active ON connector_backends(active) WHERE active = 1;
ALTER TABLE connector_accounts ADD COLUMN backend_id TEXT;
DROP INDEX idx_connector_accounts_identity;
CREATE UNIQUE INDEX idx_connector_accounts_identity
  ON connector_accounts(principal_id, backend_id, connector_id, identity_key)
  WHERE identity_key IS NOT NULL;

CREATE TABLE connector_objective_accounts (
  conversation_id TEXT NOT NULL,
  transcript_id TEXT NOT NULL,
  objective_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY(conversation_id, transcript_id, objective_id, connector_id, account_id)
);

-- Provider IDs are scoped to a backend, not the whole installation.
CREATE TABLE connector_connections_next (
  id TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES connector_installations(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  alias TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('pending','active','expired','failed','revoked','disabled','unknown')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  connected_at TEXT,
  expires_at TEXT,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE
);
INSERT INTO connector_connections_next SELECT * FROM connector_connections;
DROP TABLE connector_connections;
ALTER TABLE connector_connections_next RENAME TO connector_connections;
CREATE INDEX idx_connector_connections_principal ON connector_connections(principal_id, connector_id, status);
CREATE INDEX idx_connector_connections_account ON connector_connections(account_id);
CREATE UNIQUE INDEX idx_connector_connections_provider_backend
  ON connector_connections(provider, COALESCE(json_extract(metadata_json, '$.backendId'), ''), provider_connection_id);

CREATE TABLE connector_authorization_attempts (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  backend_id TEXT,
  connection_id TEXT NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  expected_account_id TEXT,
  authorization_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('awaiting_user','succeeded','failed','expired')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_connector_authorization_attempt_scope ON connector_authorization_attempts(principal_id,connector_id,created_at);
CREATE TABLE connector_runtime_identity (id INTEGER PRIMARY KEY CHECK(id = 1), installation_id TEXT NOT NULL);
INSERT INTO connector_runtime_identity VALUES(1, lower(hex(randomblob(16))));
ALTER TABLE connector_approvals ADD COLUMN wait_id TEXT;
