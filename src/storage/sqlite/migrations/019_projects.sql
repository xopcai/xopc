CREATE TABLE IF NOT EXISTS projects (
  project_id         TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  workspace_root     TEXT,
  brief              TEXT,
  instructions       TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  last_active_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_projects_status
  ON projects(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_slug
  ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_updated
  ON projects(updated_at DESC);

ALTER TABLE sessions ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_project
  ON sessions(project_id, updated_at DESC);

ALTER TABLE goals ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_goals_project
  ON goals(project_id, updated_at DESC);

ALTER TABLE workflow_runs ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_project
  ON workflow_runs(project_id, created_at_ms DESC);

ALTER TABLE automations ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_automations_project
  ON automations(project_id, updated_at_ms DESC);

ALTER TABLE memory_records ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_memory_records_project
  ON memory_records(project_id, updated_at DESC);
