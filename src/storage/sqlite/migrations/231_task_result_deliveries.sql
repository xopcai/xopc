ALTER TABLE task_origin_links ADD COLUMN origin_transcript_id TEXT;
ALTER TABLE task_origin_links ADD COLUMN request_input_id TEXT;
UPDATE task_origin_links SET origin_transcript_id = (
  SELECT active_transcript_id FROM sessions WHERE sessions.conversation_id = task_origin_links.conversation_id
);

CREATE TABLE task_run_outcomes (
  task_run_id TEXT NOT NULL REFERENCES task_runs(run_id) ON DELETE CASCADE,
  outcome_id TEXT NOT NULL,
  assignment_epoch INTEGER NOT NULL,
  outcome_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_run_id, outcome_id)
);

CREATE TABLE task_result_deliveries (
  delivery_id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL REFERENCES task_runs(run_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'stale', 'failed')),
  message_entry_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  notified_at INTEGER,
  UNIQUE(task_run_id, conversation_id)
);
CREATE INDEX idx_task_result_deliveries_pending
  ON task_result_deliveries(status, next_attempt_at);
