CREATE TABLE IF NOT EXISTS knowledge_source_changes (
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

CREATE INDEX IF NOT EXISTS idx_knowledge_source_changes_source_sequence
  ON knowledge_source_changes(source_instance_id, sequence);
CREATE INDEX IF NOT EXISTS idx_knowledge_source_changes_changed_at
  ON knowledge_source_changes(changed_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_consumer_watermarks (
  consumer_id         TEXT NOT NULL,
  source_instance_id  TEXT NOT NULL,
  last_sequence       INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY(consumer_id, source_instance_id)
);

ALTER TABLE knowledge_source_items ADD COLUMN synthesis_pipeline TEXT NOT NULL DEFAULT 'user_understanding'
  CHECK(synthesis_pipeline IN ('user_understanding', 'connected_knowledge'));
ALTER TABLE knowledge_source_items ADD COLUMN synthesis_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_source_items ADD COLUMN synthesis_claimed_at INTEGER;
ALTER TABLE knowledge_source_items ADD COLUMN synthesis_claimed_by TEXT;
ALTER TABLE knowledge_source_items ADD COLUMN synthesis_error TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_source_items_synthesis_lease
  ON knowledge_source_items(synthesis_pipeline, synthesis_status, synthesis_claimed_at, updated_at);

DELETE FROM memory_evidence
WHERE source_item_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM memory_evidence
    WHERE source_item_id IS NOT NULL
    GROUP BY record_id, source_item_id, relation
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_evidence_record_source_relation
  ON memory_evidence(record_id, source_item_id, relation)
  WHERE source_item_id IS NOT NULL;
