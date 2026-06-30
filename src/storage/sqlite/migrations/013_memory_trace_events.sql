CREATE TABLE IF NOT EXISTS memory_trace_events (
  trace_id              TEXT PRIMARY KEY,
  session_key           TEXT,
  turn_id               TEXT,
  phase                 TEXT NOT NULL,
  provider_id           TEXT NOT NULL,
  request_json          TEXT NOT NULL DEFAULT '{}',
  result_count          INTEGER,
  selected_record_ids_json TEXT NOT NULL DEFAULT '[]',
  skipped_reason        TEXT,
  error                 TEXT,
  duration_ms           INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_trace_created
  ON memory_trace_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_trace_provider_created
  ON memory_trace_events(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_trace_session_created
  ON memory_trace_events(session_key, created_at DESC);
