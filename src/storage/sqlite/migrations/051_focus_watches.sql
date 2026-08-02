CREATE TABLE focus_watches (
  watch_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  goal_id TEXT,
  automation_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'staleness', 'deadline', 'intelligence')),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  config_json TEXT NOT NULL DEFAULT '{}',
  trial_ends_at INTEGER,
  last_cursor TEXT,
  last_run_at INTEGER,
  last_useful_result_at INTEGER,
  consecutive_empty_runs INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (thread_id, kind),
  FOREIGN KEY (thread_id) REFERENCES work_understanding_threads(thread_id) ON DELETE CASCADE,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE SET NULL,
  FOREIGN KEY (automation_id) REFERENCES automations(automation_id) ON DELETE CASCADE
);

CREATE INDEX idx_focus_watches_thread
  ON focus_watches(thread_id, status, updated_at DESC);

CREATE INDEX idx_focus_watches_automation
  ON focus_watches(automation_id);
