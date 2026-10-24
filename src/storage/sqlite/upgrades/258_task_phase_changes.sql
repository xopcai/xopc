ALTER TABLE tasks ADD COLUMN manual_phase_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN automatic_phase_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_runs ADD COLUMN manual_phase_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE task_phase_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  from_phase TEXT NOT NULL,
  to_phase TEXT NOT NULL,
  from_resolution TEXT,
  to_resolution TEXT,
  actor_json TEXT NOT NULL,
  source TEXT NOT NULL,
  operation_id TEXT,
  run_id TEXT,
  task_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id, task_version)
);
CREATE INDEX idx_task_phase_changes_task ON task_phase_changes(task_id, task_version);
