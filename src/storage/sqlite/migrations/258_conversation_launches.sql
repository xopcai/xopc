CREATE TABLE conversation_launches (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  source_conversation_id TEXT NOT NULL,
  source_transcript_id TEXT NOT NULL,
  source_run_id TEXT,
  source_agent_id TEXT NOT NULL,
  source_tool_call_id TEXT NOT NULL,
  target_conversation_id TEXT NOT NULL UNIQUE,
  target_transcript_id TEXT NOT NULL,
  target_input_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  project_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (principal_id, source_conversation_id, idempotency_key)
);
CREATE INDEX idx_conversation_launch_source ON conversation_launches(source_conversation_id, created_at);
