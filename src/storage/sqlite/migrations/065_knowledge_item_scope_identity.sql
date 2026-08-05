CREATE TABLE memory_evidence_backup AS SELECT * FROM memory_evidence;
CREATE TABLE knowledge_source_changes_backup AS SELECT * FROM knowledge_source_changes;
CREATE TABLE user_claim_evidence_backup AS SELECT * FROM user_claim_evidence;

DROP TABLE memory_evidence;
DROP TABLE knowledge_source_changes;
DROP TABLE user_claim_evidence;

CREATE TABLE knowledge_source_items_v65 (
  item_id              TEXT PRIMARY KEY,
  source_instance_id   TEXT NOT NULL,
  collection_scope     TEXT NOT NULL,
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
  synthesis_pipeline   TEXT NOT NULL DEFAULT 'user_understanding'
    CHECK(synthesis_pipeline IN ('user_understanding', 'connected_knowledge')),
  synthesis_attempts   INTEGER NOT NULL DEFAULT 0,
  synthesis_claimed_at INTEGER,
  synthesis_claimed_by TEXT,
  synthesis_error      TEXT,
  deleted_at           INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE(source_instance_id, collection_scope, external_id)
);

INSERT INTO knowledge_source_items_v65 (
  item_id, source_instance_id, collection_scope, external_id, item_type, author_role,
  occurred_at, source_updated_at, content_hash, normalized_text, payload_ref, metadata_json,
  sensitivity, retention_class, synthesis_status, synthesis_pipeline, synthesis_attempts,
  synthesis_claimed_at, synthesis_claimed_by, synthesis_error, deleted_at, created_at, updated_at
)
SELECT
  item_id, source_instance_id, collection_scope, external_id, item_type, author_role,
  occurred_at, source_updated_at, content_hash, normalized_text, payload_ref, metadata_json,
  sensitivity, retention_class, synthesis_status, synthesis_pipeline, synthesis_attempts,
  synthesis_claimed_at, synthesis_claimed_by, synthesis_error, deleted_at, created_at, updated_at
FROM knowledge_source_items;

DROP TABLE knowledge_source_items;
ALTER TABLE knowledge_source_items_v65 RENAME TO knowledge_source_items;

CREATE INDEX idx_knowledge_source_items_source_updated
  ON knowledge_source_items(source_instance_id, updated_at DESC);
CREATE INDEX idx_knowledge_source_items_synthesis
  ON knowledge_source_items(synthesis_status, updated_at);
CREATE INDEX idx_knowledge_source_items_hash
  ON knowledge_source_items(content_hash);
CREATE INDEX idx_knowledge_source_items_synthesis_lease
  ON knowledge_source_items(synthesis_pipeline, synthesis_status, synthesis_claimed_at, updated_at);
CREATE INDEX idx_knowledge_source_items_collection
  ON knowledge_source_items(source_instance_id, collection_scope, updated_at DESC);

CREATE TABLE memory_evidence (
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
INSERT INTO memory_evidence SELECT * FROM memory_evidence_backup;
DROP TABLE memory_evidence_backup;
CREATE INDEX idx_memory_evidence_record ON memory_evidence(record_id, created_at DESC);
CREATE INDEX idx_memory_evidence_source_item ON memory_evidence(source_item_id);
CREATE UNIQUE INDEX idx_memory_evidence_record_source_relation
  ON memory_evidence(record_id, source_item_id, relation)
  WHERE source_item_id IS NOT NULL;

CREATE TABLE knowledge_source_changes (
  sequence            INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id           TEXT NOT NULL UNIQUE,
  source_instance_id  TEXT NOT NULL,
  source_item_id      TEXT NOT NULL,
  change_kind         TEXT NOT NULL CHECK(change_kind IN ('added', 'modified', 'deleted')),
  old_hash            TEXT,
  new_hash            TEXT,
  changed_at          INTEGER NOT NULL,
  FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE
);
INSERT INTO knowledge_source_changes SELECT * FROM knowledge_source_changes_backup;
DROP TABLE knowledge_source_changes_backup;
CREATE INDEX idx_knowledge_source_changes_source_sequence
  ON knowledge_source_changes(source_instance_id, sequence);
CREATE INDEX idx_knowledge_source_changes_changed_at
  ON knowledge_source_changes(changed_at DESC);

CREATE TABLE user_claim_evidence (
  claim_id           TEXT NOT NULL,
  logical_event_key  TEXT NOT NULL,
  source_item_id     TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  relation           TEXT NOT NULL CHECK(relation IN ('supports', 'contradicts')),
  observed_at        INTEGER NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY(claim_id, logical_event_key),
  FOREIGN KEY(claim_id) REFERENCES user_claims(claim_id) ON DELETE CASCADE,
  FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE
);
INSERT INTO user_claim_evidence SELECT * FROM user_claim_evidence_backup;
DROP TABLE user_claim_evidence_backup;
CREATE INDEX idx_user_claim_evidence_source ON user_claim_evidence(source_item_id);
