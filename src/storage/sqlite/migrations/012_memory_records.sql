CREATE TABLE IF NOT EXISTS memory_records (
  record_id       TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL,
  kind            TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  workspace_id    TEXT,
  session_key     TEXT,
  content         TEXT NOT NULL,
  source_json     TEXT NOT NULL,
  confidence      REAL,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_recalled_at INTEGER,
  recall_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memory_records_scope_updated
  ON memory_records(agent_id, workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_records_kind_updated
  ON memory_records(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_records_provider
  ON memory_records(provider_id, updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts USING fts5(
  content,
  record_id UNINDEXED,
  provider_id UNINDEXED,
  kind UNINDEXED,
  agent_id UNINDEXED,
  workspace_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS memory_signals (
  signal_id     TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  record_id     TEXT,
  provider_id   TEXT,
  agent_id      TEXT,
  workspace_id  TEXT,
  session_key   TEXT,
  score         REAL,
  content       TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (record_id) REFERENCES memory_records(record_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_signals_created
  ON memory_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_signals_record_created
  ON memory_signals(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_signals_scope_created
  ON memory_signals(agent_id, workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_provider_state (
  provider_id TEXT NOT NULL,
  scope_key   TEXT NOT NULL,
  state_json  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (provider_id, scope_key)
);
