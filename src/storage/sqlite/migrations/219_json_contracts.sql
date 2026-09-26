CREATE TABLE automations_next (
  automation_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL,
  trigger_json TEXT NOT NULL CHECK(json_valid(trigger_json)),
  action_json TEXT NOT NULL CHECK(json_valid(action_json)),
  reliability_json TEXT CHECK(reliability_json IS NULL OR json_valid(reliability_json)),
  state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json)),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  safety_json TEXT CHECK(safety_json IS NULL OR json_valid(safety_json)),
  project_id TEXT,
  conversation_mode TEXT NOT NULL DEFAULT 'new_session'
    CHECK(conversation_mode IN ('new_session', 'continuous')),
  management_json TEXT CHECK(management_json IS NULL OR json_valid(management_json)),
  delivery_json TEXT NOT NULL CHECK(json_valid(delivery_json))
);

INSERT INTO automations_next SELECT * FROM automations;
DROP TABLE automations;
ALTER TABLE automations_next RENAME TO automations;
CREATE INDEX idx_automations_enabled ON automations(enabled, updated_at_ms DESC);
CREATE INDEX idx_automations_updated ON automations(updated_at_ms DESC);
CREATE INDEX idx_automations_project ON automations(project_id, updated_at_ms DESC);

CREATE TABLE automation_events_next (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  occurred_at_ms INTEGER NOT NULL,
  ingested_at_ms INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  root_event_id TEXT NOT NULL,
  chain_depth INTEGER NOT NULL DEFAULT 0 CHECK(chain_depth BETWEEN 0 AND 32),
  dedupe_key TEXT,
  trust TEXT NOT NULL CHECK(trust IN ('system', 'user', 'connector', 'untrusted_webhook')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  projection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(projection_status IN ('pending', 'projecting', 'retrying', 'projected', 'dead_letter')),
  projected_at_ms INTEGER,
  projection_attempts INTEGER NOT NULL DEFAULT 0,
  projection_next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
  projection_error TEXT,
  projection_owner TEXT,
  projection_lease_until_ms INTEGER
);

INSERT INTO automation_events_next SELECT * FROM automation_events;
DROP TABLE automation_events;
ALTER TABLE automation_events_next RENAME TO automation_events;
CREATE UNIQUE INDEX idx_automation_events_source_dedupe
  ON automation_events(source, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_automation_events_projection
  ON automation_events(projection_status, projection_next_attempt_at_ms, ingested_at_ms);

CREATE TABLE automation_result_deliveries_next (
  delivery_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'delivering', 'retrying', 'delivered', 'dead_letter')),
  config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  lease_owner TEXT,
  lease_until_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(run_id, destination_key),
  FOREIGN KEY(run_id) REFERENCES automation_results(run_id) ON DELETE CASCADE
);

INSERT INTO automation_result_deliveries_next SELECT * FROM automation_result_deliveries;
DROP TABLE automation_result_deliveries;
ALTER TABLE automation_result_deliveries_next RENAME TO automation_result_deliveries;
CREATE INDEX idx_automation_result_deliveries_pending
  ON automation_result_deliveries(status, next_attempt_at_ms, created_at_ms);

CREATE TABLE ai_usage_events_next (
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
  pricing_snapshot_json TEXT CHECK(pricing_snapshot_json IS NULL OR json_valid(pricing_snapshot_json)),
  error_summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO ai_usage_events_next SELECT * FROM ai_usage_events;
DROP TABLE ai_usage_events;
ALTER TABLE ai_usage_events_next RENAME TO ai_usage_events;
CREATE INDEX idx_ai_usage_events_started ON ai_usage_events(started_at DESC, id DESC);
CREATE INDEX idx_ai_usage_events_conversation ON ai_usage_events(conversation_id, started_at DESC);
CREATE INDEX idx_ai_usage_events_trace ON ai_usage_events(trace_id, started_at ASC);
CREATE INDEX idx_ai_usage_events_agent ON ai_usage_events(agent_id, started_at DESC);
CREATE INDEX idx_ai_usage_events_category ON ai_usage_events(category, started_at DESC);
