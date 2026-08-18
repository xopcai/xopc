ALTER TABLE automation_runs ADD COLUMN heartbeat_at_ms INTEGER;
ALTER TABLE automation_runs ADD COLUMN lease_owner TEXT;
ALTER TABLE automation_runs ADD COLUMN lease_expires_at_ms INTEGER;
ALTER TABLE automation_runs ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE automation_runs ADD COLUMN root_run_id TEXT;

CREATE INDEX IF NOT EXISTS idx_automation_runs_lease
  ON automation_runs(status, lease_expires_at_ms);
