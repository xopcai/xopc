CREATE TABLE IF NOT EXISTS work_discovery_sources (
  source_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind = 'directory'),
  root_path TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  scope_json TEXT NOT NULL DEFAULT '{}',
  fingerprint_json TEXT,
  last_scanned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(kind, root_path)
);

CREATE INDEX idx_work_discovery_sources_kind_status
  ON work_discovery_sources(kind, status, updated_at DESC);
