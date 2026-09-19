ALTER TABLE connector_accounts ADD COLUMN runtime_instance_id TEXT;
CREATE UNIQUE INDEX idx_cli_account_identity ON connector_accounts(principal_id, runtime_instance_id, identity_key)
  WHERE runtime_instance_id IS NOT NULL AND identity_key IS NOT NULL;
CREATE TABLE connector_cli_authorizations (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  expected_account_id TEXT,
  context_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('preparing','awaiting_user','verifying','succeeded','failed','expired','cancelled')),
  challenge_json TEXT,
  error TEXT,
  account_id TEXT,
  owner_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_cli_active_authorization ON connector_cli_authorizations(instance_id, principal_id)
  WHERE phase IN ('preparing','awaiting_user','verifying');
CREATE TABLE connector_cli_executions (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','success','failed','unknown')),
  owner_id TEXT NOT NULL,
  error_kind TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
