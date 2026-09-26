CREATE TABLE automation_result_deliveries (
  run_id TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'delivering', 'delivered', 'failed')),
  config_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(run_id, destination_key)
);

CREATE INDEX idx_automation_result_deliveries_pending
  ON automation_result_deliveries(status, next_attempt_at_ms, created_at_ms);
