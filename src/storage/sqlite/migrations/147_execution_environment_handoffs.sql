CREATE TABLE execution_environment_handoffs (
  handoff_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  source_environment_id TEXT NOT NULL REFERENCES execution_environments(environment_id),
  target_environment_id TEXT NOT NULL,
  target_host_id TEXT NOT NULL,
  source_binding_id TEXT NOT NULL,
  source_binding_epoch INTEGER NOT NULL CHECK (source_binding_epoch > 0),
  base_sha TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'preparing', 'switching', 'cleanup_pending', 'completed', 'failed'
  )),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE UNIQUE INDEX idx_execution_environment_handoffs_active_session
  ON execution_environment_handoffs(session_key)
  WHERE status IN ('preparing', 'switching', 'cleanup_pending');

CREATE INDEX idx_execution_environment_handoffs_source
  ON execution_environment_handoffs(source_environment_id, updated_at DESC);

CREATE TABLE execution_environment_handoff_events (
  event_id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL REFERENCES execution_environment_handoffs(handoff_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_execution_environment_handoff_events_handoff
  ON execution_environment_handoff_events(handoff_id, created_at);
