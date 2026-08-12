DROP TABLE IF EXISTS focus_insights;
DROP TABLE IF EXISTS focus_activities;
DROP TABLE IF EXISTS focus_monitors;
DROP TABLE IF EXISTS focus_projects;
DROP TABLE IF EXISTS focuses;
DROP TABLE IF EXISTS focus_candidate_projects;
DROP TABLE IF EXISTS focus_candidates;

CREATE TABLE proactive_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  device_id TEXT,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system', 'integration')),
  actor_id TEXT,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  agent_id TEXT,
  occurred_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'personal', 'confidential', 'restricted')),
  payload_json TEXT NOT NULL,
  routed_at TEXT
);

CREATE TABLE proactive_signal_batches (
  batch_id TEXT PRIMARY KEY,
  scenario_key TEXT NOT NULL,
  scenario_version INTEGER NOT NULL CHECK (scenario_version > 0),
  aggregation_key TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  window_ends_at TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'collecting', 'ready', 'processing', 'processed', 'ignored',
    'failed_retryable', 'failed_permanent', 'expired'
  )),
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE proactive_batch_events (
  batch_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, event_id),
  FOREIGN KEY (batch_id) REFERENCES proactive_signal_batches(batch_id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES proactive_events(event_id) ON DELETE CASCADE
);

CREATE INDEX idx_proactive_events_type_observed
  ON proactive_events(type, observed_at DESC);
CREATE INDEX idx_proactive_events_subject
  ON proactive_events(subject_kind, subject_id, occurred_at DESC);
CREATE INDEX idx_proactive_events_project
  ON proactive_events(project_id, occurred_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX idx_proactive_events_correlation
  ON proactive_events(correlation_id);
CREATE INDEX idx_proactive_batches_ready
  ON proactive_signal_batches(status, ready_at);
CREATE UNIQUE INDEX idx_proactive_collecting_batch
  ON proactive_signal_batches(scenario_key, aggregation_key)
  WHERE status = 'collecting';
