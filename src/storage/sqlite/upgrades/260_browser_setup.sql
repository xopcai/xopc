CREATE TABLE browser_setup_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX browser_setup_conversation ON browser_setup_runs(conversation_id, agent_id, updated_at);
