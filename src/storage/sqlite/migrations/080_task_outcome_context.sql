ALTER TABLE task_outcomes ADD COLUMN project_id TEXT;
ALTER TABLE task_outcomes ADD COLUMN goal_id TEXT;
ALTER TABLE task_outcomes ADD COLUMN work_item_id TEXT;
ALTER TABLE task_outcomes ADD COLUMN origin TEXT;
ALTER TABLE task_outcomes ADD COLUMN trigger_kind TEXT;
ALTER TABLE task_outcomes ADD COLUMN parent_run_id TEXT;
ALTER TABLE task_outcomes ADD COLUMN next_action TEXT;
ALTER TABLE task_outcomes ADD COLUMN needs_user INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_outcomes ADD COLUMN context_trace_id TEXT;

CREATE INDEX idx_task_outcomes_project_updated
  ON task_outcomes(project_id, updated_at DESC);

CREATE INDEX idx_task_outcomes_work_item_updated
  ON task_outcomes(work_item_id, updated_at DESC);
