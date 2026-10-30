CREATE TABLE session_input_control (
  conversation_id TEXT PRIMARY KEY REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  paused INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  stop_run_id TEXT,
  permitted_input_id TEXT,
  review_required INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE session_input_control_operations (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  run_id TEXT,
  PRIMARY KEY (conversation_id, operation_id)
);
