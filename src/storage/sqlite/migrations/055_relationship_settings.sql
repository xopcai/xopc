CREATE TABLE relationship_settings (
  owner_id TEXT PRIMARY KEY CHECK (owner_id = 'local-owner'),
  support_mode TEXT NOT NULL CHECK (support_mode IN ('efficient', 'coach', 'companion', 'auto')),
  proactive_enabled INTEGER NOT NULL CHECK (proactive_enabled IN (0, 1)),
  quiet_start TEXT,
  quiet_end TEXT,
  allowed_topics_json TEXT NOT NULL,
  blocked_topics_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO relationship_settings (
  owner_id, support_mode, proactive_enabled, allowed_topics_json, blocked_topics_json, updated_at
) VALUES ('local-owner', 'auto', 0, '[]', '[]', unixepoch() * 1000);
