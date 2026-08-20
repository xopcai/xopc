CREATE TABLE connector_accounts (
  id                     TEXT PRIMARY KEY,
  connector_id           TEXT NOT NULL,
  principal_id           TEXT NOT NULL,
  identity_key           TEXT,
  identity_json          TEXT NOT NULL DEFAULT '{}',
  current_connection_id  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_connector_accounts_identity
  ON connector_accounts(principal_id, connector_id, identity_key)
  WHERE identity_key IS NOT NULL;

ALTER TABLE connector_connections ADD COLUMN account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE;

INSERT INTO connector_accounts (
  id, connector_id, principal_id, identity_json, current_connection_id, created_at, updated_at
)
SELECT
  'account:' || id, connector_id, principal_id, identity_json, id, created_at, updated_at
FROM connector_connections;

UPDATE connector_connections SET account_id = 'account:' || id;

CREATE TEMP TABLE connector_source_instance_migrations (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL
);

INSERT INTO connector_source_instance_migrations (old_id, new_id)
SELECT
  'composio:' || connector_id || ':' || id,
  'composio:' || connector_id || ':' || account_id
FROM connector_connections
WHERE provider = 'composio';

UPDATE knowledge_source_items
SET source_instance_id = (
  SELECT new_id FROM connector_source_instance_migrations
  WHERE old_id = knowledge_source_items.source_instance_id
)
WHERE source_instance_id IN (SELECT old_id FROM connector_source_instance_migrations);

UPDATE knowledge_sync_runs
SET source_instance_id = (
  SELECT new_id FROM connector_source_instance_migrations
  WHERE old_id = knowledge_sync_runs.source_instance_id
)
WHERE source_instance_id IN (SELECT old_id FROM connector_source_instance_migrations);

UPDATE knowledge_collection_state
SET source_instance_id = (
  SELECT new_id FROM connector_source_instance_migrations
  WHERE old_id = knowledge_collection_state.source_instance_id
)
WHERE source_instance_id IN (SELECT old_id FROM connector_source_instance_migrations);

UPDATE knowledge_source_changes
SET source_instance_id = (
  SELECT new_id FROM connector_source_instance_migrations
  WHERE old_id = knowledge_source_changes.source_instance_id
)
WHERE source_instance_id IN (SELECT old_id FROM connector_source_instance_migrations);

UPDATE knowledge_consumer_watermarks
SET source_instance_id = (
  SELECT new_id FROM connector_source_instance_migrations
  WHERE old_id = knowledge_consumer_watermarks.source_instance_id
)
WHERE source_instance_id IN (SELECT old_id FROM connector_source_instance_migrations);

UPDATE user_claim_evidence
SET source_instance_id = (
  SELECT new_id FROM connector_source_instance_migrations
  WHERE old_id = user_claim_evidence.source_instance_id
)
WHERE source_instance_id IN (SELECT old_id FROM connector_source_instance_migrations);

UPDATE connector_learning_jobs
SET source_instance_id = (
  SELECT new_id FROM connector_source_instance_migrations
  WHERE old_id = connector_learning_jobs.source_instance_id
)
WHERE source_instance_id IN (SELECT old_id FROM connector_source_instance_migrations);

UPDATE memory_records
SET source_json = json_set(
  source_json,
  '$.sourceInstanceId',
  (SELECT new_id FROM connector_source_instance_migrations
   WHERE old_id = json_extract(memory_records.source_json, '$.sourceInstanceId'))
)
WHERE json_extract(source_json, '$.sourceInstanceId') IN (
  SELECT old_id FROM connector_source_instance_migrations
);

DROP TABLE connector_source_instance_migrations;

CREATE UNIQUE INDEX idx_connector_connections_provider_identity
  ON connector_connections(provider, provider_connection_id);
CREATE INDEX idx_connector_connections_account
  ON connector_connections(account_id, status, updated_at DESC);

ALTER TABLE connector_learning_jobs ADD COLUMN account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE;
UPDATE connector_learning_jobs
SET account_id = (
  SELECT account_id FROM connector_connections
  WHERE connector_connections.id = connector_learning_jobs.connection_id
);
CREATE INDEX idx_connector_learning_jobs_account
  ON connector_learning_jobs(account_id, created_at DESC);

ALTER TABLE connector_sync_policies RENAME TO connector_sync_policies_by_connection;

CREATE TABLE connector_sync_policies (
  account_id                  TEXT PRIMARY KEY REFERENCES connector_accounts(id) ON DELETE CASCADE,
  scan_enabled               INTEGER NOT NULL DEFAULT 1 CHECK(scan_enabled IN (0, 1)),
  proactive_enabled          INTEGER NOT NULL DEFAULT 0 CHECK(proactive_enabled IN (0, 1)),
  interval_minutes           INTEGER CHECK(interval_minutes IS NULL OR interval_minutes BETWEEN 5 AND 1440),
  allowed_scenario_keys_json TEXT NOT NULL DEFAULT '[]',
  revision                   INTEGER NOT NULL DEFAULT 1,
  updated_at                 INTEGER NOT NULL
);

INSERT INTO connector_sync_policies (
  account_id, scan_enabled, proactive_enabled, interval_minutes,
  allowed_scenario_keys_json, revision, updated_at
)
SELECT
  connector_connections.account_id,
  connector_sync_policies_by_connection.scan_enabled,
  connector_sync_policies_by_connection.proactive_enabled,
  connector_sync_policies_by_connection.interval_minutes,
  connector_sync_policies_by_connection.allowed_scenario_keys_json,
  connector_sync_policies_by_connection.revision,
  connector_sync_policies_by_connection.updated_at
FROM connector_sync_policies_by_connection
JOIN connector_connections
  ON connector_connections.id = connector_sync_policies_by_connection.connection_id;

DROP TABLE connector_sync_policies_by_connection;

CREATE INDEX idx_connector_sync_policies_proactive
  ON connector_sync_policies(proactive_enabled, account_id);
