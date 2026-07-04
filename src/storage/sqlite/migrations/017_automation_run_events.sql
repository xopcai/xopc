CREATE TABLE IF NOT EXISTS automation_run_events (
  event_id       TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  automation_id  TEXT NOT NULL,
  type           TEXT NOT NULL,
  message        TEXT NOT NULL,
  data_json      TEXT,
  created_at_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_run_events_run_created
  ON automation_run_events(run_id, created_at_ms ASC);
CREATE INDEX IF NOT EXISTS idx_automation_run_events_automation_created
  ON automation_run_events(automation_id, created_at_ms DESC);
