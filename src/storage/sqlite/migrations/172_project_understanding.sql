ALTER TABLE work_discovery_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'interactive'
  CHECK (mode IN ('interactive', 'background'));
ALTER TABLE work_discovery_runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
