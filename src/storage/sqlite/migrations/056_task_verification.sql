ALTER TABLE task_outcomes ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('passed', 'failed', 'unverified'));
ALTER TABLE task_outcomes ADD COLUMN verification_json TEXT NOT NULL DEFAULT '{"checks":[]}';
ALTER TABLE task_outcomes ADD COLUMN failure_code TEXT;
ALTER TABLE task_outcomes ADD COLUMN failure_phase TEXT;
ALTER TABLE task_outcomes ADD COLUMN recovery_action TEXT;
