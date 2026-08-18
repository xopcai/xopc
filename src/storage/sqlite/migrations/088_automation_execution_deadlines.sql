ALTER TABLE automation_runs ADD COLUMN deadline_at_ms INTEGER;
ALTER TABLE automation_runs ADD COLUMN current_phase TEXT;
ALTER TABLE automation_runs ADD COLUMN cancel_requested_at_ms INTEGER;
ALTER TABLE automation_runs ADD COLUMN cancel_confirmed_at_ms INTEGER;
ALTER TABLE automation_runs ADD COLUMN termination_json TEXT;
