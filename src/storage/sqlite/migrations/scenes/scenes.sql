-- Scene tables installed atomically by the scene data migration.
CREATE TABLE scene_cutover_counts (
  source_table TEXT PRIMARY KEY, source_rows INTEGER NOT NULL CHECK(source_rows >= 0),
  converted_rows INTEGER NOT NULL CHECK(converted_rows = source_rows)
);
CREATE TABLE scene_template_versions (
  template_key TEXT NOT NULL,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  PRIMARY KEY(template_key, version)
);

-- Private definition evidence is never part of the shareable template catalog.
CREATE TABLE scene_definition_history (
  definition_key TEXT NOT NULL, record_kind TEXT NOT NULL CHECK(record_kind IN ('current', 'version')),
  version INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, instruction TEXT NOT NULL,
  instruction_version INTEGER NOT NULL, event_types_json TEXT NOT NULL CHECK(json_valid(event_types_json)),
  condition_json TEXT CHECK(condition_json IS NULL OR json_valid(condition_json)),
  grouping TEXT NOT NULL, debounce_seconds INTEGER NOT NULL, max_window_seconds INTEGER NOT NULL,
  context_providers_json TEXT NOT NULL CHECK(json_valid(context_providers_json)),
  min_confidence REAL NOT NULL, min_value_score REAL NOT NULL, cooldown_seconds INTEGER NOT NULL,
  max_runs_per_day INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER,
  PRIMARY KEY(definition_key, record_kind, version)
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

CREATE TABLE scene_checklist_imports (
  activation_id TEXT PRIMARY KEY REFERENCES scene_activations(id),
  source_path TEXT, content TEXT, content_hash TEXT,
  config_present INTEGER NOT NULL CHECK(config_present IN (0, 1)),
  enabled INTEGER, interval_ms REAL, include_system_prompt INTEGER,
  target TEXT, target_chat_id TEXT, prompt TEXT, ack_max_chars REAL, isolated_session INTEGER,
  active_start TEXT, active_end TEXT, active_timezone TEXT
);

CREATE TABLE scene_preferences (
  owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)), revision INTEGER NOT NULL CHECK(revision > 0),
  PRIMARY KEY(owner_id, workspace_id)
);

CREATE TABLE scene_instruction_revisions (
  id TEXT PRIMARY KEY, activation_id TEXT NOT NULL REFERENCES scene_activations(id),
  revision INTEGER NOT NULL CHECK(revision > 0), status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'retired')),
  base_version INTEGER NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL, published_at INTEGER, UNIQUE(activation_id, revision)
);
CREATE TABLE scene_activation_details (
  activation_id TEXT PRIMARY KEY REFERENCES scene_activations(id), source_subscription_id TEXT NOT NULL UNIQUE,
  source_definition_key TEXT NOT NULL, source_scope_kind TEXT NOT NULL, source_scope_id TEXT NOT NULL,
  previously_enabled INTEGER NOT NULL CHECK(previously_enabled IN (0, 1)),
  active_instruction_id TEXT REFERENCES scene_instruction_revisions(id), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  settings_json TEXT CHECK(settings_json IS NULL OR json_valid(settings_json)), settings_revision INTEGER,
  previous_due_at INTEGER, previous_checked_at INTEGER, previous_fingerprint TEXT
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

CREATE TABLE scene_mail_history (
  work_item_id TEXT PRIMARY KEY REFERENCES scene_work_items(id), source_subscription_id TEXT NOT NULL,
  thread_key TEXT NOT NULL, source_status TEXT NOT NULL, last_fingerprint TEXT, last_checked_at INTEGER,
  conversation_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
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
  origin TEXT NOT NULL DEFAULT 'execution' CHECK(origin IN ('execution', 'import')),
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

CREATE TABLE scene_decisions (
  id TEXT PRIMARY KEY, presentation_id TEXT NOT NULL REFERENCES scene_presentations(id),
  choice TEXT NOT NULL, note TEXT NOT NULL, recorded_at INTEGER NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('user', 'import'))
);
CREATE TABLE scene_instruction_feedback (
  id TEXT PRIMARY KEY, presentation_id TEXT NOT NULL REFERENCES scene_presentations(id),
  instruction_revision_id TEXT NOT NULL, instruction TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE scene_presentation_requests (
  idempotency_key TEXT PRIMARY KEY, presentation_id TEXT NOT NULL REFERENCES scene_presentations(id),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)), response_json TEXT NOT NULL CHECK(json_valid(response_json))
);
CREATE TABLE scene_presentation_reviews (
  presentation_id TEXT PRIMARY KEY REFERENCES scene_presentations(id), checked_at INTEGER NOT NULL
);
CREATE TABLE scene_presentation_changes (
  sequence INTEGER PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  presentation_id TEXT NOT NULL, deleted INTEGER NOT NULL CHECK(deleted IN (0, 1))
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
  origin TEXT NOT NULL CHECK(origin IN ('user', 'import')),
  recorded_at INTEGER NOT NULL,
  UNIQUE(presentation_id, revision)
);
CREATE INDEX scene_feedback_history_time ON scene_feedback_history(origin, recorded_at);

-- Historical provenance is data, never input to scheduling or authorization.
CREATE TABLE scene_event_details (
  event_id TEXT PRIMARY KEY REFERENCES scene_events(id),
  schema_version INTEGER NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
  device_id TEXT, subject_kind TEXT NOT NULL, actor_kind TEXT NOT NULL, actor_id TEXT,
  project_id TEXT, agent_id TEXT, correlation_id TEXT NOT NULL, causation_id TEXT,
  sensitivity TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), routed_at INTEGER
);
CREATE TABLE scene_intent_events (
  intent_id TEXT NOT NULL REFERENCES scene_trigger_intents(id), event_id TEXT NOT NULL REFERENCES scene_events(id),
  added_at INTEGER NOT NULL, PRIMARY KEY(intent_id, event_id)
);
CREATE TABLE scene_intent_details (
  intent_id TEXT PRIMARY KEY REFERENCES scene_trigger_intents(id),
  source_template_key TEXT NOT NULL, source_template_version INTEGER NOT NULL, source_subscription_id TEXT NOT NULL,
  aggregation_key TEXT NOT NULL, window_started_at INTEGER NOT NULL, window_ends_at INTEGER NOT NULL,
  source_status TEXT NOT NULL, event_count INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE scene_evidence_snapshots (
  id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES scene_trigger_intents(id),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)), created_at INTEGER NOT NULL
);
CREATE TABLE scene_run_details (
  run_id TEXT PRIMARY KEY REFERENCES scene_runs(id),
  source_template_key TEXT NOT NULL, source_template_version INTEGER NOT NULL, source_subscription_id TEXT NOT NULL,
  instruction_revision_id TEXT, evidence_snapshot_id TEXT REFERENCES scene_evidence_snapshots(id),
  source_status TEXT NOT NULL, model_ref TEXT, raw_output TEXT, error_message TEXT,
  completed_at INTEGER, updated_at INTEGER NOT NULL, source_retry_at INTEGER, source_reason TEXT,
  policy_revision INTEGER NOT NULL, subscription_revision INTEGER NOT NULL,
  policy_snapshot_json TEXT CHECK(policy_snapshot_json IS NULL OR json_valid(policy_snapshot_json)),
  input_tokens INTEGER, output_tokens INTEGER, estimated_cost_usd REAL
);

CREATE TABLE scene_check_details (
  run_id TEXT PRIMARY KEY REFERENCES scene_runs(id), source_check_id TEXT NOT NULL UNIQUE,
  source_workspace_id TEXT NOT NULL, source_status TEXT NOT NULL, completed_at INTEGER,
  detail TEXT, content TEXT, target TEXT, chat_id TEXT, fingerprint TEXT,
  delivery_status TEXT NOT NULL, next_attempt_at INTEGER, expires_at INTEGER NOT NULL
);
