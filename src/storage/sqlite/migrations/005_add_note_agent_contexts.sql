CREATE TABLE IF NOT EXISTS note_agent_contexts (
  note_id TEXT PRIMARY KEY,
  note_updated_at INTEGER NOT NULL,
  context_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_agent_contexts_generated
  ON note_agent_contexts(generated_at DESC);
