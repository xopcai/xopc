DROP TABLE IF EXISTS browser_recipe_run_events;
DROP TABLE IF EXISTS browser_recipe_runs;
DROP TABLE IF EXISTS browser_recipes;

CREATE TABLE IF NOT EXISTS browser_automations (
  automation_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  definition_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_automation_runs (
  run_id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  automation_revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  inputs_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  duration_ms INTEGER,
  FOREIGN KEY (automation_id) REFERENCES browser_automations(automation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_browser_automation_runs_automation_created
  ON browser_automation_runs(automation_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS browser_action_audit (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(run_id, seq),
  FOREIGN KEY (run_id) REFERENCES browser_automation_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_browser_action_audit_run_seq
  ON browser_action_audit(run_id, seq ASC);
