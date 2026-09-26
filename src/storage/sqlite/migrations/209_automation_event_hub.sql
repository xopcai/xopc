CREATE TABLE automation_events (
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
  payload_json TEXT NOT NULL,
  projected_at_ms INTEGER,
  projection_attempts INTEGER NOT NULL DEFAULT 0,
  projection_error TEXT
);

CREATE UNIQUE INDEX idx_automation_events_source_dedupe
  ON automation_events(source, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX idx_automation_events_projection
  ON automation_events(projected_at_ms, ingested_at_ms);

CREATE TABLE automation_event_deliveries (
  event_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'queued', 'completed', 'failed', 'cancelled', 'skipped')),
  run_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(event_id, automation_id),
  FOREIGN KEY(event_id) REFERENCES automation_events(event_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_automation_event_deliveries_run
  ON automation_event_deliveries(run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX idx_automation_event_deliveries_pending
  ON automation_event_deliveries(status, next_attempt_at_ms, created_at_ms);
