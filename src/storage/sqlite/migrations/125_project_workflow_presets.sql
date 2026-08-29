CREATE TABLE project_workflow_presets (
  project_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  context_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, definition_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE INDEX idx_project_workflow_presets_updated
  ON project_workflow_presets(project_id, updated_at DESC);
