CREATE TABLE IF NOT EXISTS browser_recipes (
  recipe_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('published', 'disabled')),
  yaml_source TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('read_only', 'account_write', 'sensitive')),
  domains_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_recipe_runs (
  run_id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  recipe_revision INTEGER NOT NULL,
  recipe_yaml TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  args_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  duration_ms INTEGER,
  FOREIGN KEY (recipe_id) REFERENCES browser_recipes(recipe_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_browser_recipe_runs_recipe_created
  ON browser_recipe_runs(recipe_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS browser_recipe_run_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(run_id, seq),
  FOREIGN KEY (run_id) REFERENCES browser_recipe_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_browser_recipe_run_events_run_seq
  ON browser_recipe_run_events(run_id, seq ASC);
