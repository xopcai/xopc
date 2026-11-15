CREATE TABLE session_agent_reactions (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES transcripts(transcript_id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  entry_id TEXT NOT NULL UNIQUE REFERENCES transcript_entries(entry_id) ON DELETE CASCADE,
  actor_agent_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, transcript_id, client_message_id)
);

CREATE INDEX idx_session_agent_reactions_cooldown ON session_agent_reactions(conversation_id, created_at_ms);
