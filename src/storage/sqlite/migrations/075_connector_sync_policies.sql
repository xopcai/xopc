CREATE TABLE connector_sync_policies (
  connection_id               TEXT PRIMARY KEY,
  scan_enabled                INTEGER NOT NULL DEFAULT 1 CHECK(scan_enabled IN (0, 1)),
  proactive_enabled           INTEGER NOT NULL DEFAULT 0 CHECK(proactive_enabled IN (0, 1)),
  interval_minutes            INTEGER CHECK(interval_minutes IS NULL OR interval_minutes BETWEEN 5 AND 1440),
  allowed_scenario_keys_json  TEXT NOT NULL DEFAULT '[]',
  revision                    INTEGER NOT NULL DEFAULT 1,
  updated_at                  INTEGER NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES connector_connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_connector_sync_policies_proactive
  ON connector_sync_policies(proactive_enabled, connection_id);
