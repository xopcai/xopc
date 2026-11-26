CREATE TABLE external_agent_session_bindings (
  transcript_id TEXT PRIMARY KEY REFERENCES transcripts(transcript_id) ON DELETE CASCADE,
  runtime_kind TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  native_session_id TEXT NOT NULL,
  resume_cursor TEXT,
  last_input_entry_id TEXT,
  metadata_json TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (runtime_kind, native_session_id)
);
