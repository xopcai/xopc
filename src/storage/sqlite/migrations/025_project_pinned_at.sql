ALTER TABLE projects ADD COLUMN pinned_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_projects_pinned
  ON projects(pinned_at DESC)
  WHERE pinned_at IS NOT NULL;
