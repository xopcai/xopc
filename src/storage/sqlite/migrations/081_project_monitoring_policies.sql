CREATE TABLE project_monitoring_policies (
  project_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('observe', 'ask_before_action', 'auto_low_risk')),
  quiet_hours_json TEXT,
  allowed_actions_json TEXT NOT NULL DEFAULT '[]',
  confidence_threshold REAL NOT NULL DEFAULT 0.75 CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
