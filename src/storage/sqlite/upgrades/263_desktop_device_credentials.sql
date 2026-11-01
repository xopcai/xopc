-- The upgrade runner disables foreign keys before the enclosing transaction,
-- preserves all dependent rows and validates foreign keys before committing.
CREATE TABLE devices_desktop_upgrade (
  device_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'harmonyos', 'chrome', 'desktop')),
  extension_id TEXT CHECK (extension_id IS NULL OR length(extension_id) = 32),
  public_key_jwk TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  request_proof_version INTEGER NOT NULL DEFAULT 1,
  CHECK ((platform = 'chrome') = (extension_id IS NOT NULL))
);
INSERT INTO devices_desktop_upgrade
  SELECT device_id, display_name, platform, extension_id, public_key_jwk,
    scopes_json, created_at, last_seen_at, revoked_at, request_proof_version FROM devices;
DROP TABLE devices;
ALTER TABLE devices_desktop_upgrade RENAME TO devices;

CREATE TABLE device_pairing_sessions_desktop_upgrade (
  pairing_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  routes_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts_remaining INTEGER NOT NULL CHECK (attempts_remaining >= 0),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  enrollment_issuer TEXT,
  enrollment_extension_id TEXT,
  enrollment_public_key_thumbprint TEXT,
  enrollment_nonce TEXT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('mobile', 'browser', 'desktop'))
);
INSERT INTO device_pairing_sessions_desktop_upgrade SELECT * FROM device_pairing_sessions;
DROP TABLE device_pairing_sessions;
ALTER TABLE device_pairing_sessions_desktop_upgrade RENAME TO device_pairing_sessions;
CREATE INDEX idx_device_pairing_sessions_expiry ON device_pairing_sessions(expires_at);
