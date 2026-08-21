CREATE TABLE endpoint_principals (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK(kind IN ('web', 'desktop', 'mobile')),
  display_name TEXT NOT NULL,
  platform     TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);

CREATE INDEX idx_endpoint_principals_active
  ON endpoint_principals(kind, last_seen_at DESC)
  WHERE revoked_at IS NULL;
