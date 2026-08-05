CREATE TABLE connector_learning_jobs (
  job_id               TEXT PRIMARY KEY,
  idempotency_key      TEXT NOT NULL UNIQUE,
  connector_id         TEXT NOT NULL,
  connection_id        TEXT NOT NULL,
  source_instance_id   TEXT NOT NULL,
  agent_id              TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK(mode IN ('bootstrap', 'incremental')),
  status                TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'paused')),
  phase                 TEXT NOT NULL CHECK(phase IN ('queued', 'fetching', 'indexing', 'deriving', 'completed')),
  items_discovered      INTEGER NOT NULL DEFAULT 0,
  items_indexed         INTEGER NOT NULL DEFAULT 0,
  candidates_created    INTEGER NOT NULL DEFAULT 0,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  error                 TEXT,
  next_run_at           INTEGER,
  started_at            INTEGER,
  finished_at           INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES connector_connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_connector_learning_jobs_due
  ON connector_learning_jobs(status, next_run_at, created_at);
CREATE INDEX idx_connector_learning_jobs_source
  ON connector_learning_jobs(source_instance_id, created_at DESC);
