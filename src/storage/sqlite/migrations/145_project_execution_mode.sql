ALTER TABLE projects ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'local_checkout'
  CHECK (execution_mode IN ('local_checkout', 'managed_worktree'));

CREATE INDEX idx_projects_execution_mode
  ON projects(execution_mode, updated_at DESC);
