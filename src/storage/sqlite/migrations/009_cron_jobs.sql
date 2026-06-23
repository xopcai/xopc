CREATE TABLE IF NOT EXISTS cron_jobs (
  job_id                  TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  description             TEXT,
  enabled                 INTEGER NOT NULL,
  delete_after_run         INTEGER,
  created_at_ms            INTEGER NOT NULL,
  updated_at_ms            INTEGER NOT NULL,
  schedule_json            TEXT NOT NULL,
  session_target           TEXT NOT NULL,
  wake_mode                TEXT NOT NULL,
  agent_id                 TEXT,
  session_key              TEXT,
  working_directory        TEXT,
  payload_json             TEXT NOT NULL,
  delivery_json            TEXT,
  failure_alert_json       TEXT,
  state_json               TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled_next
  ON cron_jobs(enabled, job_id);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_updated
  ON cron_jobs(updated_at_ms DESC);
