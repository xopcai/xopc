-- The runner disables foreign keys outside the transaction for this parent-table rebuild.
-- All existing device identities and dependent credential/session records are retained.
CREATE TABLE devices_harmonyos (
  device_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'harmonyos', 'chrome')),
  extension_id TEXT CHECK (extension_id IS NULL OR length(extension_id) = 32),
  public_key_jwk TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  CHECK ((platform = 'chrome') = (extension_id IS NOT NULL))
);
INSERT INTO devices_harmonyos
  (device_id, display_name, platform, extension_id, public_key_jwk, scopes_json, created_at, last_seen_at, revoked_at)
SELECT device_id, display_name, platform, extension_id, public_key_jwk, scopes_json, created_at, last_seen_at, revoked_at
FROM devices;
DROP TABLE devices;
ALTER TABLE devices_harmonyos RENAME TO devices;

CREATE TABLE device_push_endpoints_harmonyos (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'harmonyos')),
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
INSERT INTO device_push_endpoints_harmonyos
  SELECT device_id, platform, push_token, enabled, permissions, preferences_json, locale,
    app_version, lease_expires_at, last_seen_at, created_at, updated_at FROM device_push_endpoints;
DROP TABLE device_push_endpoints;
ALTER TABLE device_push_endpoints_harmonyos RENAME TO device_push_endpoints;
