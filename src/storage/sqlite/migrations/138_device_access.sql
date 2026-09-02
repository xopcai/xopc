CREATE TABLE gateway_identity (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  gateway_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  public_key_jwk TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE device_pairing_sessions (
  pairing_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  routes_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts_remaining INTEGER NOT NULL CHECK (attempts_remaining >= 0),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX idx_device_pairing_sessions_expiry
  ON device_pairing_sessions(expires_at);

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

CREATE INDEX idx_device_refresh_credentials_device
  ON device_refresh_credentials(device_id, expires_at);

CREATE TABLE device_access_sessions (
  session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_device_access_sessions_device
  ON device_access_sessions(device_id, expires_at);

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

DROP INDEX idx_notification_deliveries_due;
ALTER TABLE notification_deliveries RENAME TO obsolete_notification_deliveries;

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

CREATE INDEX idx_notification_deliveries_due
  ON notification_deliveries(status, next_attempt_at);

DROP TABLE obsolete_notification_deliveries;
DROP TABLE notification_devices;
