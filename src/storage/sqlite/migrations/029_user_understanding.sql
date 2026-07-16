-- Repair support for databases whose schema version was advanced by an older
-- partial build without the optional memory subsystem tables.
CREATE TABLE IF NOT EXISTS memory_records (
  record_id          TEXT PRIMARY KEY,
  provider_id        TEXT NOT NULL,
  kind               TEXT NOT NULL,
  agent_id           TEXT NOT NULL,
  workspace_id       TEXT,
  session_key        TEXT,
  project_id         TEXT,
  content            TEXT NOT NULL,
  source_json        TEXT NOT NULL,
  confidence         REAL,
  tags_json          TEXT NOT NULL DEFAULT '[]',
  status             TEXT NOT NULL DEFAULT 'active',
  sensitivity        TEXT NOT NULL DEFAULT 'normal',
  evidence_json      TEXT NOT NULL DEFAULT '[]',
  review_after       INTEGER,
  expires_at         INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  last_recalled_at   INTEGER,
  recall_count       INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE memory_records ADD COLUMN canonical_key TEXT;
ALTER TABLE memory_records ADD COLUMN explicitness TEXT NOT NULL DEFAULT 'inferred';
ALTER TABLE memory_records ADD COLUMN durability TEXT NOT NULL DEFAULT 'durable';
ALTER TABLE memory_records ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
ALTER TABLE memory_records ADD COLUMN disclosure_policy TEXT NOT NULL DEFAULT 'referenceable';
ALTER TABLE memory_records ADD COLUMN valid_from INTEGER;
ALTER TABLE memory_records ADD COLUMN valid_to INTEGER;
ALTER TABLE memory_records ADD COLUMN supersedes_record_id TEXT;
ALTER TABLE memory_records ADD COLUMN conflict_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_memory_records_canonical_status
  ON memory_records(agent_id, canonical_key, status);
CREATE INDEX IF NOT EXISTS idx_memory_records_validity
  ON memory_records(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS idx_memory_records_conflict_group
  ON memory_records(conflict_group_id);

CREATE TABLE IF NOT EXISTS knowledge_sync_runs (
  run_id              TEXT PRIMARY KEY,
  source_instance_id  TEXT NOT NULL,
  status              TEXT NOT NULL,
  cursor_before       TEXT,
  cursor_after        TEXT,
  items_seen          INTEGER NOT NULL DEFAULT 0,
  items_created       INTEGER NOT NULL DEFAULT 0,
  items_updated       INTEGER NOT NULL DEFAULT 0,
  warnings_json       TEXT NOT NULL DEFAULT '[]',
  error               TEXT,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sync_runs_source_started
  ON knowledge_sync_runs(source_instance_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_sync_runs_status_started
  ON knowledge_sync_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_source_state (
  source_instance_id  TEXT PRIMARY KEY,
  cursor              TEXT,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_source_items (
  item_id              TEXT PRIMARY KEY,
  source_instance_id   TEXT NOT NULL,
  external_id          TEXT NOT NULL,
  item_type            TEXT NOT NULL,
  author_role          TEXT,
  occurred_at          INTEGER,
  source_updated_at    INTEGER,
  content_hash         TEXT NOT NULL,
  normalized_text      TEXT,
  payload_ref          TEXT,
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  sensitivity          TEXT NOT NULL DEFAULT 'normal',
  retention_class      TEXT NOT NULL DEFAULT 'bounded',
  synthesis_status     TEXT NOT NULL DEFAULT 'pending',
  deleted_at           INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE(source_instance_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_source_items_source_updated
  ON knowledge_source_items(source_instance_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_items_synthesis
  ON knowledge_source_items(synthesis_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_items_hash
  ON knowledge_source_items(content_hash);

CREATE TABLE IF NOT EXISTS memory_evidence (
  evidence_id       TEXT PRIMARY KEY,
  record_id         TEXT NOT NULL,
  source_item_id    TEXT,
  relation          TEXT NOT NULL,
  excerpt           TEXT,
  confidence        REAL,
  observed_at       INTEGER,
  created_at        INTEGER NOT NULL,
  FOREIGN KEY(record_id) REFERENCES memory_records(record_id) ON DELETE CASCADE,
  FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_evidence_record
  ON memory_evidence(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_evidence_source_item
  ON memory_evidence(source_item_id);

CREATE TABLE IF NOT EXISTS memory_relations (
  relation_id      TEXT PRIMARY KEY,
  from_record_id   TEXT NOT NULL,
  relation_type    TEXT NOT NULL,
  to_record_id     TEXT NOT NULL,
  confidence       REAL NOT NULL,
  valid_from       INTEGER,
  valid_to         INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE(from_record_id, relation_type, to_record_id),
  FOREIGN KEY(from_record_id) REFERENCES memory_records(record_id) ON DELETE CASCADE,
  FOREIGN KEY(to_record_id) REFERENCES memory_records(record_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_relations_from
  ON memory_relations(from_record_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_memory_relations_to
  ON memory_relations(to_record_id, relation_type);
