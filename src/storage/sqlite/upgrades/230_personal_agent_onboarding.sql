CREATE TABLE personal_agent_onboarding (
  owner_id TEXT PRIMARY KEY,
  step TEXT NOT NULL,
  draft_json TEXT NOT NULL DEFAULT '{}',
  completed_at INTEGER,
  welcome_finished_at INTEGER,
  updated_at INTEGER NOT NULL
);
