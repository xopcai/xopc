CREATE TABLE next_turn_suggestions (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('zh', 'en')),
  suggestion_id TEXT NOT NULL UNIQUE,
  snapshot_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ready', 'none')),
  payload_json TEXT,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, locale)
);
CREATE TABLE next_turn_suggestion_feedback (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  suggestion_id TEXT NOT NULL,
  impression_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('shown', 'accepted', 'dismissed', 'submitted')),
  edited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, impression_id, event)
);
CREATE INDEX idx_next_turn_feedback_created ON next_turn_suggestion_feedback(created_at);
