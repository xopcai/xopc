CREATE TABLE IF NOT EXISTS goal_contracts (
  goal_id              TEXT PRIMARY KEY,
  version              INTEGER NOT NULL DEFAULT 1,
  objective            TEXT NOT NULL,
  scope_boundary       TEXT,
  evidence_plan_json   TEXT NOT NULL DEFAULT '[]',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

ALTER TABLE goal_contracts ADD COLUMN outcome_metric_json TEXT;
