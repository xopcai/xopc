CREATE TABLE session_inputs (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  requested_delivery TEXT NOT NULL CHECK (requested_delivery IN ('next', 'steer')),
  effective_delivery TEXT NOT NULL CHECK (effective_delivery IN ('next', 'steer')),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'injecting',
    'completed', 'cancelled', 'failed', 'interrupted'
  )),
  content TEXT NOT NULL,
  attachments_json TEXT,
  thinking TEXT,
  position INTEGER NOT NULL,
  target_run_id TEXT,
  run_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_key, client_message_id)
);

CREATE INDEX idx_session_inputs_pending
  ON session_inputs(session_key, status, position, created_at_ms);

CREATE TABLE session_input_runtime (
  session_key TEXT PRIMARY KEY,
  active_run_id TEXT,
  active_input_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

ALTER TABLE sessions DROP COLUMN abort_cutoff_timestamp;
