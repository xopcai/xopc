ALTER TABLE memory_records ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE memory_records ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE memory_records ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE memory_records ADD COLUMN review_after INTEGER;
ALTER TABLE memory_records ADD COLUMN expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_memory_records_status_updated
  ON memory_records(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_records_status_scope_updated
  ON memory_records(status, agent_id, workspace_id, updated_at DESC);
