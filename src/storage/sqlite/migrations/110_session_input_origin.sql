DROP INDEX idx_session_inputs_pending;

CREATE TABLE session_inputs_v110 (
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
  origin_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  target_run_id TEXT,
  run_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(session_key, client_message_id)
);

INSERT INTO session_inputs_v110 (
  id, session_key, client_message_id, requested_delivery, effective_delivery,
  status, content, attachments_json, thinking, origin_json, position,
  target_run_id, run_id, version, error, created_at_ms, updated_at_ms
)
SELECT
  id, session_key, client_message_id, requested_delivery, effective_delivery,
  status, content, attachments_json, thinking,
  '{"type":"system","source":"internal"}', position,
  target_run_id, run_id, version, error, created_at_ms, updated_at_ms
FROM session_inputs;

DROP TABLE session_inputs;
ALTER TABLE session_inputs_v110 RENAME TO session_inputs;

CREATE INDEX idx_session_inputs_pending
  ON session_inputs(session_key, status, position, created_at_ms);
