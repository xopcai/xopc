CREATE TABLE task_outcomes (
  run_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  summary TEXT,
  contract_json TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  feedback_outcome TEXT CHECK (feedback_outcome IN ('helpful', 'not_helpful')),
  feedback_reason TEXT,
  needs_correction INTEGER CHECK (needs_correction IN (0, 1)),
  support_fit INTEGER CHECK (support_fit IN (0, 1)),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX idx_task_outcomes_session_started
  ON task_outcomes(session_key, started_at DESC);

CREATE INDEX idx_task_outcomes_status_started
  ON task_outcomes(status, started_at DESC);
