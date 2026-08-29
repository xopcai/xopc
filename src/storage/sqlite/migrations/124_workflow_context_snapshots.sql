CREATE TABLE workflow_context_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  project_id TEXT,
  selected_items_json TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_workflow_context_snapshots_run
  ON workflow_context_snapshots(run_id, created_at DESC);
CREATE INDEX idx_workflow_context_snapshots_project
  ON workflow_context_snapshots(project_id, created_at DESC);
