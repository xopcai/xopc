CREATE TABLE IF NOT EXISTS user_trust_policies (
  principal_id TEXT PRIMARY KEY,
  default_action_level TEXT NOT NULL DEFAULT 'confirm'
    CHECK (default_action_level IN ('observe', 'suggest', 'confirm')),
  updated_at TEXT NOT NULL
);
