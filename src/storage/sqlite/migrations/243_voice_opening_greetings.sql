CREATE TABLE voice_opening_greetings (
  principal_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  logical_call_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('claimed', 'completed', 'skipped', 'interrupted', 'failed', 'expired')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (principal_id, conversation_id, logical_call_id)
);
CREATE INDEX idx_voice_opening_greetings_created ON voice_opening_greetings(created_at);
