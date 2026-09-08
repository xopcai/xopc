CREATE TABLE session_clarification_waits (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  origin_run_id TEXT NOT NULL,
  origin_tool_call_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'open', 'queued', 'resolved', 'expired', 'cancelled', 'superseded'
  )),
  version INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE(session_id, origin_run_id, origin_tool_call_id)
);

CREATE UNIQUE INDEX idx_clarification_wait_active
  ON session_clarification_waits(principal_id, session_id)
  WHERE status IN ('open', 'queued');

CREATE INDEX idx_clarification_wait_session
  ON session_clarification_waits(session_key, session_id, status);

CREATE TABLE session_inputs_v154 (
  id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  requested_delivery TEXT NOT NULL CHECK (requested_delivery IN ('next', 'steer')),
  effective_delivery TEXT NOT NULL CHECK (effective_delivery IN ('next', 'steer')),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'injecting',
    'completed', 'cancelled', 'failed', 'interrupted', 'suspended'
  )),
  content TEXT NOT NULL,
  attachments_json TEXT,
  thinking TEXT,
  origin_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  target_run_id TEXT,
  run_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  expected_session_id TEXT,
  context_refs_json TEXT,
  context_snapshots_json TEXT,
  kind TEXT NOT NULL DEFAULT 'message' CHECK (
    kind IN ('message', 'connection_resume', 'clarification_resume')
  ),
  payload_json TEXT,
  task_run_id TEXT,
  UNIQUE(session_key, client_message_id)
);

INSERT INTO session_inputs_v154
SELECT * FROM session_inputs;
DROP TABLE session_inputs;
ALTER TABLE session_inputs_v154 RENAME TO session_inputs;
CREATE INDEX idx_session_inputs_pending
  ON session_inputs(session_key,status,position,created_at_ms);
