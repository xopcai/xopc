CREATE TABLE IF NOT EXISTS scene_source_health (
  activation_id TEXT PRIMARY KEY REFERENCES scene_activations(id) ON DELETE CASCADE,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  reason TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER
);
