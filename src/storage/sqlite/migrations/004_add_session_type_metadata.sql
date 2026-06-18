ALTER TABLE sessions ADD COLUMN hidden_from_session_list INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN parent_session_key TEXT;
ALTER TABLE sessions ADD COLUMN workflow_run_id TEXT;
ALTER TABLE sessions ADD COLUMN workflow_definition_id TEXT;
ALTER TABLE sessions ADD COLUMN workflow_agent_id TEXT;
ALTER TABLE sessions ADD COLUMN workflow_agent_label TEXT;

UPDATE sessions SET session_type = 'chat' WHERE session_type IS NULL OR TRIM(session_type) = '';

CREATE INDEX IF NOT EXISTS idx_sessions_type
  ON sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_sessions_workflow_run
  ON sessions(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent
  ON sessions(parent_session_key);
