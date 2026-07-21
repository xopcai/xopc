DROP INDEX IF EXISTS idx_memory_records_scope_updated;
DROP INDEX IF EXISTS idx_memory_records_canonical_status;
ALTER TABLE memory_records RENAME COLUMN agent_id TO source_agent_id;
ALTER TABLE memory_records ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local-owner';
UPDATE memory_records SET kind = 'curated_note' WHERE kind = 'agent_note';

DELETE FROM automations
WHERE automation_id IN ('system-dreaming-light', 'system-dreaming-deep', 'system-dreaming-rem')
   OR automation_id LIKE 'system-dreaming:%';
CREATE INDEX idx_memory_records_user_updated
  ON memory_records(user_id, updated_at DESC);
CREATE INDEX idx_memory_records_user_project
  ON memory_records(user_id, project_id);
CREATE INDEX idx_memory_records_user_status
  ON memory_records(user_id, status);
CREATE INDEX idx_memory_records_source_agent
  ON memory_records(source_agent_id);
CREATE INDEX idx_memory_records_canonical_status
  ON memory_records(user_id, canonical_key, status);

DROP TABLE memory_records_fts;
CREATE VIRTUAL TABLE memory_records_fts USING fts5(
  content,
  record_id UNINDEXED,
  provider_id UNINDEXED,
  kind UNINDEXED,
  user_id UNINDEXED,
  source_agent_id UNINDEXED,
  workspace_id UNINDEXED,
  tokenize='unicode61'
);
INSERT INTO memory_records_fts (
  content, record_id, provider_id, kind, user_id, source_agent_id, workspace_id
)
SELECT content, record_id, provider_id, kind, user_id, source_agent_id, workspace_id
FROM memory_records
WHERE trim(content) <> '';

DROP INDEX IF EXISTS idx_memory_signals_scope_created;
ALTER TABLE memory_signals RENAME COLUMN agent_id TO source_agent_id;
ALTER TABLE memory_signals ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local-owner';
CREATE INDEX idx_memory_signals_user_created
  ON memory_signals(user_id, created_at DESC);
CREATE INDEX idx_memory_signals_source_agent_created
  ON memory_signals(source_agent_id, created_at DESC);

ALTER TABLE memory_trace_events ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local-owner';
ALTER TABLE memory_trace_events ADD COLUMN source_agent_id TEXT;
CREATE INDEX idx_memory_trace_user_created
  ON memory_trace_events(user_id, created_at DESC);
CREATE INDEX idx_memory_trace_source_agent_created
  ON memory_trace_events(source_agent_id, created_at DESC);

ALTER TABLE memory_files RENAME COLUMN agent_id TO user_id;
DROP TABLE memory_fts;
CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  chunk_id UNINDEXED,
  user_id UNINDEXED,
  path UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED,
  tokenize='unicode61'
);
INSERT INTO memory_fts (content, chunk_id, user_id, path, start_line, end_line)
SELECT chunks.content, chunks.chunk_id, files.user_id, files.path, chunks.start_line, chunks.end_line
FROM memory_chunks AS chunks
JOIN memory_files AS files ON files.file_id = chunks.file_id;
