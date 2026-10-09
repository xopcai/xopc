CREATE TABLE personal_reply_jobs (
  reply_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  task_run_id TEXT NOT NULL REFERENCES task_runs(run_id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','generating','ready','delivered','stale')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  text TEXT,
  draft_transcript_id TEXT,
  message_entry_id TEXT,
  notified_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_personal_reply_pending ON personal_reply_jobs(status, next_attempt_at, lease_until);
