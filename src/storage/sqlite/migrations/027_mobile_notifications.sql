CREATE TABLE IF NOT EXISTS mobile_devices (
  device_id             TEXT PRIMARY KEY,
  platform              TEXT NOT NULL,
  push_token            TEXT NOT NULL,
  push_provider         TEXT NOT NULL DEFAULT 'expo',
  enabled               INTEGER NOT NULL DEFAULT 1,
  permissions           TEXT NOT NULL DEFAULT 'unknown',
  preferences_json      TEXT NOT NULL DEFAULT '{}',
  app_version           TEXT,
  last_seen_at          INTEGER NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_devices_push_token
  ON mobile_devices(push_provider, push_token);
CREATE INDEX IF NOT EXISTS idx_mobile_devices_enabled
  ON mobile_devices(enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS mobile_activity_events (
  event_id              TEXT PRIMARY KEY,
  event_type            TEXT NOT NULL,
  entity_kind           TEXT NOT NULL,
  entity_id             TEXT NOT NULL,
  priority              TEXT NOT NULL,
  title                 TEXT NOT NULL,
  body                  TEXT,
  deep_link             TEXT NOT NULL,
  payload_json          TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_activity_events_created
  ON mobile_activity_events(created_at DESC);

CREATE TABLE IF NOT EXISTS mobile_activity_acknowledgements (
  event_id              TEXT NOT NULL,
  device_id             TEXT NOT NULL,
  acknowledged_at       INTEGER NOT NULL,
  PRIMARY KEY (event_id, device_id),
  FOREIGN KEY (event_id) REFERENCES mobile_activity_events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES mobile_devices(device_id) ON DELETE CASCADE
);
