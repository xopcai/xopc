CREATE TABLE desktop_execution_stops (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL,
  authorization_revision INTEGER NOT NULL CHECK (authorization_revision > 0),
  stop_id TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  grant_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, grant_id, authorization_revision)
);
