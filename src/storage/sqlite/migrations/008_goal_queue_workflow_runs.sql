CREATE TABLE IF NOT EXISTS goal_queue (
  queue_id       TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL,
  status         TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  attempts       INTEGER NOT NULL,
  max_retries    INTEGER NOT NULL,
  enqueued_at    INTEGER NOT NULL,
  started_at     INTEGER,
  finished_at    INTEGER,
  next_run_at    INTEGER,
  session_key    TEXT,
  last_error     TEXT,
  source         TEXT NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_queue_status_next
  ON goal_queue(status, next_run_at, enqueued_at);
CREATE INDEX IF NOT EXISTS idx_goal_queue_goal_status
  ON goal_queue(goal_id, status);
CREATE INDEX IF NOT EXISTS idx_goal_queue_enqueued
  ON goal_queue(enqueued_at DESC);

CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id              TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  definition_id       TEXT NOT NULL,
  definition_version  TEXT NOT NULL,
  goal_id             TEXT,
  session_key         TEXT NOT NULL,
  parent_session_key  TEXT,
  status              TEXT NOT NULL,
  source_kind         TEXT NOT NULL,
  source_json         TEXT NOT NULL,
  metadata_json       TEXT,
  title               TEXT NOT NULL,
  created_at_ms       INTEGER NOT NULL,
  started_at_ms       INTEGER,
  completed_at_ms     INTEGER,
  metrics_json        TEXT NOT NULL,
  result_preview      TEXT,
  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_goal_created
  ON workflow_runs(goal_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_created
  ON workflow_runs(agent_id, status, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_definition_created
  ON workflow_runs(definition_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_created
  ON workflow_runs(agent_id, created_at_ms DESC);
