CREATE TABLE work_discovery_runs_v44 (
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

INSERT INTO work_discovery_runs_v44 (
  id,
  idempotency_key,
  source,
  status,
  stage,
  root_path,
  project_id,
  session_key,
  agent_id,
  model_ref,
  scan_policy_version,
  snapshot_summary_json,
  result_json,
  error_code,
  error_message,
  created_at,
  started_at,
  completed_at,
  canceled_at
)
SELECT
  id,
  idempotency_key,
  source,
  status,
  stage,
  root_path,
  project_id,
  session_key,
  agent_id,
  model_ref,
  scan_policy_version,
  snapshot_summary_json,
  result_json,
  error_code,
  error_message,
  created_at,
  started_at,
  completed_at,
  canceled_at
FROM work_discovery_runs;

DROP TABLE work_discovery_runs;
ALTER TABLE work_discovery_runs_v44 RENAME TO work_discovery_runs;

CREATE INDEX idx_work_discovery_runs_status_created
  ON work_discovery_runs(status, created_at DESC);

CREATE INDEX idx_work_discovery_runs_project
  ON work_discovery_runs(project_id, created_at DESC);
