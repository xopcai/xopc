CREATE TABLE IF NOT EXISTS automations (
  automation_id     TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  enabled           INTEGER NOT NULL,
  trigger_json      TEXT NOT NULL,
  action_json       TEXT NOT NULL,
  after_run_json    TEXT,
  reliability_json  TEXT,
  state_json        TEXT NOT NULL DEFAULT '{}',
  created_at_ms     INTEGER NOT NULL,
  updated_at_ms     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automations_enabled
  ON automations(enabled, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_automations_updated
  ON automations(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS automation_runs (
  run_id                 TEXT PRIMARY KEY,
  automation_id          TEXT NOT NULL,
  automation_name        TEXT NOT NULL,
  status                 TEXT NOT NULL,
  trigger_snapshot_json  TEXT NOT NULL,
  action_snapshot_json   TEXT NOT NULL,
  manual                 INTEGER NOT NULL,
  created_at_ms          INTEGER NOT NULL,
  started_at_ms          INTEGER,
  ended_at_ms            INTEGER,
  duration_ms            INTEGER,
  summary                TEXT,
  error                  TEXT,
  session_key            TEXT,
  workflow_run_id        TEXT,
  model                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_created
  ON automation_runs(automation_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_created
  ON automation_runs(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status_created
  ON automation_runs(status, created_at_ms DESC);

DROP TABLE IF EXISTS cron_jobs;
DROP TABLE IF EXISTS cron_runs;
