PRAGMA defer_foreign_keys = ON;

-- Rebuild the device table and every table that references it. SQLite rewrites
-- foreign-key targets on table rename, so rebuilding only `devices` would leave
-- references pointing at the temporary table name.
ALTER TABLE notification_deliveries RENAME TO notification_deliveries_v154;
ALTER TABLE device_pairing_requests RENAME TO device_pairing_requests_v154;
ALTER TABLE device_refresh_credentials RENAME TO device_refresh_credentials_v154;
ALTER TABLE device_access_sessions RENAME TO device_access_sessions_v154;
ALTER TABLE device_push_endpoints RENAME TO device_push_endpoints_v154;
ALTER TABLE devices RENAME TO devices_v154;

DROP INDEX idx_notification_deliveries_due;
DROP INDEX idx_device_pairing_requests_expiry;
DROP INDEX idx_device_refresh_credentials_device;
DROP INDEX idx_device_access_sessions_device;

CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'chrome')),
  extension_id TEXT CHECK (extension_id IS NULL OR length(extension_id) = 32),
  public_key_jwk TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  CHECK ((platform = 'chrome') = (extension_id IS NOT NULL))
);

CREATE TABLE device_refresh_credentials (
  credential_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  replaced_by TEXT REFERENCES device_refresh_credentials(credential_id),
  rotation_request_id TEXT,
  revoked_at INTEGER
);

CREATE TABLE device_access_sessions (
  session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE device_push_endpoints (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  push_token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  permissions TEXT NOT NULL CHECK (permissions IN ('granted', 'denied', 'unknown')),
  preferences_json TEXT NOT NULL DEFAULT '{}',
  locale TEXT NOT NULL CHECK (locale IN ('en', 'zh')),
  app_version TEXT,
  lease_expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE device_pairing_requests (
  request_id TEXT PRIMARY KEY,
  pairing_id TEXT NOT NULL UNIQUE REFERENCES device_pairing_sessions(pairing_id) ON DELETE CASCADE,
  device_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'cancelled', 'expired')),
  revision INTEGER NOT NULL DEFAULT 1,
  confirmation_code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  recovery_until INTEGER NOT NULL,
  completion_key TEXT,
  initial_token_hash TEXT,
  device_id TEXT REFERENCES devices(device_id),
  created_at INTEGER NOT NULL
);

CREATE TABLE notification_deliveries (
  event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'delivered', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  provider_ticket_id TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, device_id),
  FOREIGN KEY (event_id) REFERENCES notification_events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES device_push_endpoints(device_id) ON DELETE CASCADE
);

INSERT INTO devices
SELECT device_id, display_name, platform, NULL, public_key_jwk, scopes_json,
  created_at, last_seen_at, revoked_at
FROM devices_v154;
INSERT INTO device_refresh_credentials SELECT * FROM device_refresh_credentials_v154;
INSERT INTO device_access_sessions SELECT * FROM device_access_sessions_v154;
INSERT INTO device_push_endpoints SELECT * FROM device_push_endpoints_v154;
INSERT INTO device_pairing_requests SELECT * FROM device_pairing_requests_v154;
INSERT INTO notification_deliveries SELECT * FROM notification_deliveries_v154;

DROP TABLE notification_deliveries_v154;
DROP TABLE device_pairing_requests_v154;
DROP TABLE device_refresh_credentials_v154;
DROP TABLE device_access_sessions_v154;
DROP TABLE device_push_endpoints_v154;
DROP TABLE devices_v154;

CREATE INDEX idx_notification_deliveries_due
  ON notification_deliveries(status, next_attempt_at);
CREATE INDEX idx_device_pairing_requests_expiry
  ON device_pairing_requests(recovery_until);
CREATE INDEX idx_device_refresh_credentials_device
  ON device_refresh_credentials(device_id, expires_at);
CREATE INDEX idx_device_access_sessions_device
  ON device_access_sessions(device_id, expires_at);
