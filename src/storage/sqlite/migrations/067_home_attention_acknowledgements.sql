CREATE TABLE IF NOT EXISTS home_attention_acknowledgements (
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('automation_run', 'workflow_run')),
  subject_id TEXT NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  PRIMARY KEY (subject_kind, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_home_attention_acknowledged_at
  ON home_attention_acknowledgements(acknowledged_at DESC);
