CREATE TABLE endpoint_principals_next (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('web', 'desktop', 'mobile', 'browser', 'bridge')),
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);
INSERT INTO endpoint_principals_next SELECT * FROM endpoint_principals;
DROP TABLE endpoint_principals;
ALTER TABLE endpoint_principals_next RENAME TO endpoint_principals;

CREATE TABLE devices_next (
  device_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'harmonyos', 'chrome', 'desktop', 'bridge')),
  extension_id TEXT CHECK (extension_id IS NULL OR length(extension_id) = 32),
  public_key_jwk TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  request_proof_version INTEGER NOT NULL DEFAULT 1 CHECK(request_proof_version IN (0, 1)),
  CHECK ((platform = 'chrome') = (extension_id IS NOT NULL))
);
INSERT INTO devices_next SELECT * FROM devices;
DROP TABLE devices;
ALTER TABLE devices_next RENAME TO devices;
