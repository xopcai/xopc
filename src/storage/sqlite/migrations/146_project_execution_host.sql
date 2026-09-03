ALTER TABLE projects ADD COLUMN execution_host_id TEXT
  REFERENCES execution_hosts(host_id) ON DELETE SET NULL;

CREATE INDEX idx_projects_execution_host
  ON projects(execution_host_id, updated_at DESC);
