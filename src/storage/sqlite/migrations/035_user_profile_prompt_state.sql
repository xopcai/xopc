CREATE TABLE IF NOT EXISTS user_profile_prompt_state (
  principal_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'snoozed')),
  suggestion_hash TEXT,
  snoozed_until TEXT,
  updated_at TEXT NOT NULL
);
