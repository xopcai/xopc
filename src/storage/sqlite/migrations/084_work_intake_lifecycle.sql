CREATE TABLE work_intakes (
  intake_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  objective TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  session_key TEXT,
  agent_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'expired', 'cancelled')),
  execution_mode TEXT NOT NULL DEFAULT 'run_now' CHECK (execution_mode IN ('create_only', 'run_now')),
  project_id TEXT,
  goal_id TEXT,
  queue_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE SET NULL
);

CREATE INDEX idx_work_intakes_status_updated
  ON work_intakes(status, updated_at DESC);

CREATE INDEX idx_work_intakes_expires
  ON work_intakes(status, expires_at);
