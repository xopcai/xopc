ALTER TABLE memory_records ADD COLUMN origin_class TEXT NOT NULL DEFAULT 'untrusted'
  CHECK (origin_class IN ('owner', 'agent', 'untrusted', 'system'));
ALTER TABLE memory_records ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'unknown'
  CHECK (session_kind IN ('interactive', 'group', 'automation', 'workflow', 'subagent', 'background', 'unknown'));
ALTER TABLE memory_records ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_records ADD COLUMN source_session_id TEXT;
ALTER TABLE memory_records ADD COLUMN source_turn_id TEXT;
ALTER TABLE memory_records ADD COLUMN supersedes_key TEXT;
ALTER TABLE memory_records ADD COLUMN derived_from_recalled_context INTEGER NOT NULL DEFAULT 0
  CHECK (derived_from_recalled_context IN (0, 1));

UPDATE memory_records
SET observed_at = CASE WHEN observed_at = 0 THEN created_at ELSE observed_at END;

CREATE INDEX idx_memory_records_trusted_scope_updated
  ON memory_records(origin_class, derived_from_recalled_context, status, workspace_id, updated_at DESC);
CREATE INDEX idx_memory_records_source_turn
  ON memory_records(source_session_id, source_turn_id);
