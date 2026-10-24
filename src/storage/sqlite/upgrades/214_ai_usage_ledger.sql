CREATE TABLE ai_usage_events (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_event_id TEXT,
  conversation_id TEXT,
  run_id TEXT,
  agent_id TEXT,
  category TEXT NOT NULL,
  operation TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  reason_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'aborted', 'unknown')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_microusd INTEGER,
  cost_source TEXT NOT NULL CHECK(cost_source IN ('model_catalog', 'local', 'unknown')),
  pricing_snapshot_json TEXT,
  error_summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_ai_usage_events_started
  ON ai_usage_events(started_at DESC, id DESC);
CREATE INDEX idx_ai_usage_events_conversation
  ON ai_usage_events(conversation_id, started_at DESC);
CREATE INDEX idx_ai_usage_events_trace
  ON ai_usage_events(trace_id, started_at ASC);
CREATE INDEX idx_ai_usage_events_agent
  ON ai_usage_events(agent_id, started_at DESC);
CREATE INDEX idx_ai_usage_events_category
  ON ai_usage_events(category, started_at DESC);
