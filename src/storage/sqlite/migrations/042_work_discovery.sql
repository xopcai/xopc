CREATE TABLE IF NOT EXISTS work_discovery_onboarding (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'dismissed')),
  active_run_id TEXT,
  completed_at INTEGER,
  dismissed_at INTEGER,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO work_discovery_onboarding (singleton_id, status, updated_at)
VALUES (1, 'not_started', 0);

CREATE TABLE IF NOT EXISTS work_discovery_runs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('onboarding_selected_directory', 'manual_selected_directory')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'probing', 'analyzing', 'completed', 'failed', 'canceled')),
  stage TEXT CHECK (stage IS NULL OR stage IN ('folder_structure', 'recent_progress', 'next_steps')),
  root_path TEXT NOT NULL,
  project_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  scan_policy_version INTEGER NOT NULL,
  snapshot_summary_json TEXT,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  canceled_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_discovery_runs_status_created
  ON work_discovery_runs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_discovery_runs_project
  ON work_discovery_runs(project_id, created_at DESC);
