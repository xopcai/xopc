ALTER TABLE task_main_update_deliveries
  ADD COLUMN decision TEXT CHECK (decision IN ('notify', 'silent'));

ALTER TABLE task_main_update_deliveries
  ADD COLUMN decision_reason TEXT;

ALTER TABLE task_main_update_deliveries
  ADD COLUMN decided_at INTEGER;
