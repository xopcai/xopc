-- Current scene storage. Historical experimental data is discarded.
CREATE TABLE scene_template_versions (
  template_key TEXT NOT NULL,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  PRIMARY KEY(template_key, version)
);

CREATE TABLE scene_activations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  template_version TEXT NOT NULL,
  goal TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  permissions_json TEXT NOT NULL CHECK(json_valid(permissions_json)),
  status TEXT NOT NULL CHECK(status IN ('needs_setup', 'active', 'paused', 'completed', 'archived')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  FOREIGN KEY(template_key, template_version) REFERENCES scene_template_versions(template_key, version)
);

CREATE INDEX scene_activations_owner ON scene_activations(owner_id, workspace_id, status);

CREATE TABLE scene_preferences (
  owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)), revision INTEGER NOT NULL CHECK(revision > 0),
  PRIMARY KEY(owner_id, workspace_id)
);

CREATE TABLE scene_notes (
  activation_id TEXT PRIMARY KEY REFERENCES scene_activations(id),
  content TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  valid_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE scene_activation_requests (
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  activation_id TEXT NOT NULL REFERENCES scene_activations(id),
  PRIMARY KEY(owner_id, workspace_id, request_id)
);

CREATE TABLE scene_work_items (
  id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES scene_activations(id),
  subject_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN ('watching', 'paused', 'completed')),
  last_triggered_revision INTEGER,
  last_check_reason TEXT,
  observed_fingerprint TEXT,
  observation_sequence INTEGER NOT NULL DEFAULT 0,
  UNIQUE(activation_id, account_id, subject_id)
);

CREATE TABLE scene_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  account_id TEXT,
  UNIQUE(owner_id, workspace_id, source, source_event_id)
);

CREATE TABLE scene_trigger_intents (
  id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES scene_activations(id),
  activation_revision INTEGER NOT NULL,
  trigger_key TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  event_id TEXT REFERENCES scene_events(id),
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'claimed', 'resolved', 'cancelled')),
  UNIQUE(activation_id, trigger_key, occurrence_key)
);

CREATE INDEX scene_intents_due ON scene_trigger_intents(status, due_at);

CREATE TABLE scene_schedule_cursors (
  activation_id TEXT NOT NULL REFERENCES scene_activations(id),
  trigger_key TEXT NOT NULL,
  schedule_json TEXT NOT NULL CHECK(json_valid(schedule_json)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  next_due_at INTEGER NOT NULL,
  PRIMARY KEY(activation_id, trigger_key)
);

CREATE INDEX scene_schedules_due ON scene_schedule_cursors(next_due_at);

CREATE TABLE scene_runs (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES scene_trigger_intents(id),
  activation_id TEXT NOT NULL REFERENCES scene_activations(id),
  activation_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'skipped', 'retry_wait', 'failed', 'cancelled')),
  attempt INTEGER NOT NULL CHECK(attempt > 0),
  lease_epoch INTEGER NOT NULL CHECK(lease_epoch > 0),
  lease_owner TEXT,
  lease_until INTEGER,
  retry_at INTEGER,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX scene_runs_lease ON scene_runs(status, lease_until);

CREATE TABLE scene_model_reservations (
  run_id TEXT NOT NULL REFERENCES scene_runs(id),
  lease_epoch INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  activation_id TEXT NOT NULL REFERENCES scene_activations(id),
  reserved_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, lease_epoch)
);

CREATE INDEX scene_model_budget ON scene_model_reservations(owner_id, reserved_at);

CREATE UNIQUE INDEX scene_runs_single_active ON scene_runs(activation_id) WHERE status IN ('running', 'retry_wait');

CREATE TABLE scene_context_snapshots (
  run_id TEXT NOT NULL REFERENCES scene_runs(id),
  lease_epoch INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, lease_epoch)
);

CREATE TABLE scene_outcomes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES scene_runs(id),
  kind TEXT NOT NULL CHECK(kind IN ('no_change', 'observation', 'artifact', 'decision', 'state_change', 'effect_proposal', 'receipt')),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE scene_presentations (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL UNIQUE REFERENCES scene_outcomes(id),
  destination TEXT NOT NULL CHECK(destination = 'inbox'),
  status TEXT NOT NULL CHECK(status IN ('unread', 'read', 'snoozed', 'resolved', 'withdrawn')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER, snoozed_until INTEGER, expires_at INTEGER, withdrawn_at INTEGER, actionable_until INTEGER,
  resolution TEXT, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  notification_revision INTEGER NOT NULL DEFAULT 1 CHECK(notification_revision > 0), correlation_key TEXT
);

CREATE TABLE scene_feedback (
  presentation_id TEXT PRIMARY KEY REFERENCES scene_presentations(id),
  rating TEXT NOT NULL CHECK(rating IN ('useful', 'not_useful')),
  note TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE scene_feedback_history (
  id TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES scene_presentations(id),
  rating TEXT NOT NULL CHECK(rating IN ('useful', 'not_useful')),
  note TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  recorded_at INTEGER NOT NULL,
  UNIQUE(presentation_id, revision)
);

CREATE INDEX scene_feedback_history_time ON scene_feedback_history(recorded_at);

CREATE TABLE scene_intent_events (
  intent_id TEXT NOT NULL REFERENCES scene_trigger_intents(id), event_id TEXT NOT NULL REFERENCES scene_events(id),
  added_at INTEGER NOT NULL, PRIMARY KEY(intent_id, event_id)
);

CREATE TABLE scene_mail_sources (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL, thread_id TEXT NOT NULL, subject TEXT NOT NULL, sender TEXT NOT NULL,
  selected_at INTEGER NOT NULL,
  UNIQUE(owner_id, workspace_id, account_id, thread_id)
);

CREATE TABLE scene_model_usage (
  run_id TEXT NOT NULL REFERENCES scene_runs(id), lease_epoch INTEGER NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL, estimated_cost REAL NOT NULL,
  recorded_at INTEGER NOT NULL, PRIMARY KEY(run_id, lease_epoch)
);

CREATE TABLE scene_connector_usage (
  owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, account_id TEXT NOT NULL,
  utc_day INTEGER NOT NULL, request_count INTEGER NOT NULL,
  PRIMARY KEY(owner_id, workspace_id, account_id, utc_day)
);
CREATE TABLE IF NOT EXISTS scene_source_health (
  activation_id TEXT PRIMARY KEY REFERENCES scene_activations(id) ON DELETE CASCADE,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  reason TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER
);
