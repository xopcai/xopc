ALTER TABLE tasks ADD COLUMN board_rank INTEGER NOT NULL DEFAULT 0;

UPDATE tasks SET board_rank = created_at;

CREATE INDEX idx_tasks_project_phase_rank
  ON tasks(project_id, phase, board_rank, created_at);
