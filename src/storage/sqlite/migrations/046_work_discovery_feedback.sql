CREATE TABLE IF NOT EXISTS work_discovery_feedback (
  run_id TEXT PRIMARY KEY,
  recognition_decision TEXT NOT NULL CHECK (
    recognition_decision IN ('confirmed', 'corrected', 'different_goal', 'dismissed')
  ),
  corrected_intent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES work_discovery_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_discovery_feedback_updated
  ON work_discovery_feedback(updated_at DESC);
