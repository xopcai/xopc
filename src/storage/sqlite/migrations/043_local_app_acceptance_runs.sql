CREATE TABLE IF NOT EXISTS local_app_acceptance_runs (
  run_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  checks_json TEXT NOT NULL,
  interactive_count INTEGER NOT NULL DEFAULT 0 CHECK (interactive_count >= 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES local_apps(app_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_local_app_acceptance_runs_app_created
  ON local_app_acceptance_runs(app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_local_app_acceptance_runs_source
  ON local_app_acceptance_runs(app_id, source_hash, created_at DESC);
