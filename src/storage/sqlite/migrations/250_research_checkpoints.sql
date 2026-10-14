CREATE TABLE research_checkpoints (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  workspace TEXT NOT NULL,
  goal TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json)),
  status TEXT NOT NULL CHECK(status IN ('running','partial','completed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  summary TEXT NOT NULL DEFAULT '',
  lease_token TEXT,
  lease_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX research_checkpoints_conversation ON research_checkpoints(conversation_id, updated_at);
