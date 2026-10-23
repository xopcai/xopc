CREATE TABLE IF NOT EXISTS schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

CREATE TABLE transcripts (
  "transcript_id"        TEXT PRIMARY KEY,
  "conversation_id"        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  archive_reason     TEXT,
  created_at         INTEGER NOT NULL,
  archived_at        INTEGER,
  cwd                TEXT NOT NULL
);

CREATE TABLE transcript_entries (
  entry_id        TEXT PRIMARY KEY,
  "transcript_id"       TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  entry_kind      TEXT NOT NULL,
  role            TEXT,
  payload_json    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE("transcript_id", seq),
  FOREIGN KEY ("transcript_id") REFERENCES transcripts("transcript_id")
);

CREATE TABLE automation_runs (
  run_id                 TEXT PRIMARY KEY,
  automation_id          TEXT NOT NULL,
  automation_name        TEXT NOT NULL,
  status                 TEXT NOT NULL,
  trigger_snapshot_json  TEXT NOT NULL,
  action_snapshot_json   TEXT NOT NULL,
  manual                 INTEGER NOT NULL,
  created_at_ms          INTEGER NOT NULL,
  started_at_ms          INTEGER,
  ended_at_ms            INTEGER,
  duration_ms            INTEGER,
  summary                TEXT,
  error                  TEXT,
  "conversation_id"            TEXT,
  model                  TEXT
, deadline_at_ms INTEGER, current_phase TEXT, cancel_requested_at_ms INTEGER, cancel_confirmed_at_ms INTEGER, termination_json TEXT, heartbeat_at_ms INTEGER, lease_owner TEXT, lease_expires_at_ms INTEGER, attempt_number INTEGER NOT NULL DEFAULT 1, root_run_id TEXT, read_at_ms INTEGER);

CREATE TABLE automation_run_events (
  event_id       TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  automation_id  TEXT NOT NULL,
  type           TEXT NOT NULL,
  message        TEXT NOT NULL,
  data_json      TEXT,
  created_at_ms  INTEGER NOT NULL
);

CREATE TABLE home_attention_acknowledgements (
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('automation_run')),
  subject_id TEXT NOT NULL,
  acknowledged_at INTEGER NOT NULL,
  PRIMARY KEY (subject_kind, subject_id)
);

CREATE TABLE notes (
  note_id               TEXT PRIMARY KEY,
  title                 TEXT,
  kind                  TEXT NOT NULL,
  status                TEXT NOT NULL,
  payload_json          TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  pinned                INTEGER NOT NULL DEFAULT 0,
  tags_json             TEXT NOT NULL DEFAULT '[]',
  snippet               TEXT,
  cover_attachment_id   TEXT,
  voice_attachment_id   TEXT,
  voice_duration_sec    REAL,
  attachment_names_json TEXT,
  group_id              TEXT,
  last_opened_at        INTEGER,
  task_done             INTEGER,
  task_due_at           INTEGER,
  heading_count         INTEGER,
  task_count            INTEGER,
  unchecked_task_count  INTEGER,
  link_count            INTEGER
);

CREATE TABLE note_agent_contexts (
  note_id TEXT PRIMARY KEY,
  note_updated_at INTEGER NOT NULL,
  context_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  content,
  note_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE activity_events (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,
  primary_object_kind   TEXT NOT NULL,
  primary_object_id     TEXT NOT NULL,
  primary_object_title  TEXT,
  actor_json            TEXT NOT NULL,
  initiator_json        TEXT,
  source_json           TEXT NOT NULL,
  payload_json          TEXT NOT NULL DEFAULT '{}',
  visibility            TEXT NOT NULL,
  importance            TEXT NOT NULL,
  created_at            INTEGER NOT NULL
);

CREATE TABLE activity_scopes (
  activity_id  TEXT NOT NULL,
  scope_kind   TEXT NOT NULL,
  scope_id     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  PRIMARY KEY (activity_id, scope_kind, scope_id, reason)
);

CREATE TABLE object_links (
  id          TEXT PRIMARY KEY,
  from_kind   TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  from_title  TEXT,
  to_kind     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  to_title    TEXT,
  relation    TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE activity_related_projects (
  activity_id  TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  reason       TEXT NOT NULL,
  confidence   REAL NOT NULL,
  computed_at  INTEGER NOT NULL,
  PRIMARY KEY (activity_id, project_id, reason)
);

CREATE TABLE browser_automations (
  automation_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  definition_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE browser_automation_runs (
  run_id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  automation_revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  inputs_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  duration_ms INTEGER, client_request_id TEXT, business_outcome TEXT,
  FOREIGN KEY (automation_id) REFERENCES browser_automations(automation_id) ON DELETE CASCADE
);

CREATE TABLE browser_action_audit (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT,
  created_at_ms INTEGER NOT NULL,
  UNIQUE(run_id, seq),
  FOREIGN KEY (run_id) REFERENCES browser_automation_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE projects (
  project_id         TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  workspace_root     TEXT,
  brief              TEXT,
  instructions       TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  last_active_at     INTEGER
, default_agent_id TEXT, pinned_at INTEGER, outcome TEXT, success_criteria_json TEXT NOT NULL DEFAULT '[]', scope_json TEXT NOT NULL DEFAULT '{}', non_goals_json TEXT NOT NULL DEFAULT '[]', health TEXT NOT NULL DEFAULT 'unknown'
  CHECK (health IN ('unknown', 'on_track', 'at_risk', 'off_track')), owner_id TEXT, target_at INTEGER, version INTEGER NOT NULL DEFAULT 1, execution_mode TEXT NOT NULL DEFAULT 'local_checkout'
  CHECK (execution_mode IN ('local_checkout', 'managed_worktree')));

CREATE VIRTUAL TABLE projects_fts USING fts5(
  content,
  project_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE knowledge_sync_runs (
  run_id              TEXT PRIMARY KEY,
  source_instance_id  TEXT NOT NULL,
  status              TEXT NOT NULL,
  cursor_before       TEXT,
  cursor_after        TEXT,
  items_seen          INTEGER NOT NULL DEFAULT 0,
  items_created       INTEGER NOT NULL DEFAULT 0,
  items_updated       INTEGER NOT NULL DEFAULT 0,
  warnings_json       TEXT NOT NULL DEFAULT '[]',
  error               TEXT,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER
, collection_scope TEXT);

CREATE TABLE knowledge_consumer_watermarks (
  consumer_id         TEXT NOT NULL,
  source_instance_id  TEXT NOT NULL,
  last_sequence       INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY(consumer_id, source_instance_id)
);

CREATE TABLE local_apps (
  app_id          TEXT PRIMARY KEY,
  extension_id    TEXT NOT NULL UNIQUE,
  project_id      TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  idea            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('preview_ready', 'installed', 'degraded')),
  workspace_root  TEXT NOT NULL UNIQUE,
  preview_token   TEXT NOT NULL UNIQUE,
  draft_version   INTEGER NOT NULL DEFAULT 1,
  active_version  INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  installed_at    INTEGER, installation_state TEXT NOT NULL DEFAULT 'not_installed'
  CHECK (installation_state IN ('not_installed', 'installed')), enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)), active_release_id TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE local_app_releases (
  release_id      TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL,
  version         INTEGER NOT NULL,
  source_hash     TEXT NOT NULL,
  created_at      INTEGER NOT NULL, artifact_path TEXT, manifest_json TEXT NOT NULL DEFAULT '{}', health_status TEXT NOT NULL DEFAULT 'healthy'
  CHECK (health_status IN ('healthy', 'failed')), activated_at INTEGER,
  UNIQUE(app_id, version),
  FOREIGN KEY (app_id) REFERENCES local_apps(app_id) ON DELETE CASCADE
);

CREATE TABLE work_discovery_onboarding (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'dismissed')),
  active_run_id TEXT,
  completed_at INTEGER,
  dismissed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE local_app_acceptance_runs (
  run_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  checks_json TEXT NOT NULL,
  interactive_count INTEGER NOT NULL DEFAULT 0 CHECK (interactive_count >= 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (app_id) REFERENCES local_apps(app_id) ON DELETE CASCADE
);

CREATE TABLE "work_discovery_runs" (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('onboarding_selected_directory', 'manual_selected_directory')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'probing', 'analyzing', 'completed', 'failed', 'canceled')),
  stage TEXT CHECK (stage IS NULL OR stage IN ('folder_structure', 'recent_progress', 'next_steps')),
  root_path TEXT NOT NULL,
  project_id TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  scan_policy_version INTEGER NOT NULL,
  snapshot_summary_json TEXT,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  canceled_at INTEGER, mode TEXT NOT NULL DEFAULT 'interactive'
  CHECK (mode IN ('interactive', 'background')), attempts INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  FOREIGN KEY ("conversation_id") REFERENCES sessions("conversation_id") ON DELETE CASCADE
);

CREATE TABLE extension_ui_grants (
  extension_id TEXT NOT NULL,
  app_id TEXT,
  manifest_digest TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (extension_id, manifest_digest),
  FOREIGN KEY (app_id) REFERENCES local_apps(app_id) ON DELETE CASCADE
);

CREATE TABLE work_discovery_feedback (
  run_id TEXT PRIMARY KEY,
  recognition_decision TEXT NOT NULL CHECK (
    recognition_decision IN ('confirmed', 'corrected', 'different_goal', 'dismissed')
  ),
  corrected_intent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES work_discovery_runs(id) ON DELETE CASCADE
);

CREATE TABLE work_understanding_investigations (
  investigation_id TEXT PRIMARY KEY,
  discovery_run_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'planning', 'investigating', 'synthesizing', 'completed', 'failed', 'canceled'
  )),
  plan_json TEXT NOT NULL DEFAULT '{}',
  budget_json TEXT NOT NULL,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  content_chars_read INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (discovery_run_id) REFERENCES work_discovery_runs(id) ON DELETE CASCADE
);

CREATE TABLE interaction_states (
  "conversation_id" TEXT PRIMARY KEY REFERENCES sessions("conversation_id") ON DELETE CASCADE,
  support_need TEXT NOT NULL CHECK (support_need IN ('listen', 'clarify', 'advise', 'act', 'unknown')),
  emotion_hypothesis TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL CHECK (source IN ('explicit', 'inferred')),
  repair_status TEXT NOT NULL CHECK (repair_status IN ('none', 'needed', 'repaired')),
  repair_reason TEXT,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE connector_learning_jobs (
  job_id               TEXT PRIMARY KEY,
  idempotency_key      TEXT NOT NULL UNIQUE,
  connector_id         TEXT NOT NULL,
  connection_id        TEXT NOT NULL,
  source_instance_id   TEXT NOT NULL,
  agent_id              TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK(mode IN ('bootstrap', 'incremental')),
  status                TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'paused')),
  phase                 TEXT NOT NULL CHECK(phase IN ('queued', 'fetching', 'indexing', 'deriving', 'completed')),
  items_discovered      INTEGER NOT NULL DEFAULT 0,
  items_indexed         INTEGER NOT NULL DEFAULT 0,
  candidates_created    INTEGER NOT NULL DEFAULT 0,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  error                 TEXT,
  next_run_at           INTEGER,
  started_at            INTEGER,
  finished_at           INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL, account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(connection_id) REFERENCES connector_connections(id) ON DELETE CASCADE
);

CREATE TABLE knowledge_collection_state (
  source_instance_id TEXT NOT NULL,
  collection_scope   TEXT NOT NULL,
  cursor             TEXT,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY(source_instance_id, collection_scope)
);

CREATE TABLE "knowledge_source_items" (
  item_id              TEXT PRIMARY KEY,
  source_instance_id   TEXT NOT NULL,
  collection_scope     TEXT NOT NULL,
  external_id          TEXT NOT NULL,
  item_type            TEXT NOT NULL,
  author_role          TEXT,
  occurred_at          INTEGER,
  source_updated_at    INTEGER,
  content_hash         TEXT NOT NULL,
  normalized_text      TEXT,
  payload_ref          TEXT,
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  sensitivity          TEXT NOT NULL DEFAULT 'normal',
  retention_class      TEXT NOT NULL DEFAULT 'bounded',
  synthesis_status     TEXT NOT NULL DEFAULT 'pending',
  synthesis_pipeline   TEXT NOT NULL DEFAULT 'user_understanding'
    CHECK(synthesis_pipeline IN ('user_understanding', 'connected_knowledge')),
  synthesis_attempts   INTEGER NOT NULL DEFAULT 0,
  synthesis_claimed_at INTEGER,
  synthesis_claimed_by TEXT,
  synthesis_error      TEXT,
  deleted_at           INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE(source_instance_id, collection_scope, external_id)
);

CREATE TABLE knowledge_source_changes (
  sequence            INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id           TEXT NOT NULL UNIQUE,
  source_instance_id  TEXT NOT NULL,
  source_item_id      TEXT NOT NULL,
  change_kind         TEXT NOT NULL CHECK(change_kind IN ('added', 'modified', 'deleted')),
  old_hash            TEXT,
  new_hash            TEXT,
  changed_at          INTEGER NOT NULL,
  FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE
);

CREATE TABLE discussion_capture_settings (
  workspace_id               TEXT PRIMARY KEY,
  consent_policy_version     INTEGER NOT NULL,
  consent_acknowledged_at    INTEGER,
  updated_at                 INTEGER NOT NULL
);

CREATE TABLE session_task_plans (
  "transcript_id"  TEXT NOT NULL,
  plan_id     TEXT NOT NULL,
  items_json  TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY ("transcript_id", plan_id),
  FOREIGN KEY ("transcript_id") REFERENCES transcripts("transcript_id") ON DELETE CASCADE
);

CREATE TABLE session_input_runtime (
  "conversation_id" TEXT PRIMARY KEY,
  active_run_id TEXT,
  active_input_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE discussion_captures (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  note_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  audio_attachment_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'recording', 'stopping', 'sealing', 'organizing',
    'completed', 'needs_attention', 'cancelled'
  )),
  duration_ms INTEGER,
  expected_last_sequence INTEGER,
  mime_type TEXT,
  audio_size_bytes INTEGER,
  audio_sha256 TEXT,
  canonical_transcript TEXT,
  canonical_transcript_sha256 TEXT,
  transcript_language TEXT,
  transcript_revision INTEGER NOT NULL DEFAULT 0,
  generated_title TEXT,
  project_inference_score REAL,
  project_inference_source TEXT,
  failure_stage TEXT CHECK (failure_stage IN (
    'segment_upload', 'segment_transcription', 'audio_upload',
    'transcript_sealing', 'organization'
  )),
  failure_code TEXT,
  failure_message TEXT,
  work_lease_owner TEXT,
  work_lease_expires_at INTEGER,
  recording_started_at INTEGER NOT NULL,
  recording_stopped_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  audio_deleted_at INTEGER, organization_template TEXT NOT NULL DEFAULT 'general', source TEXT NOT NULL DEFAULT 'web'
  CHECK (source IN ('web', 'electron', 'mobile')),
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

CREATE TABLE discussion_transcript_segments (
  discussion_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  audio_sha256 TEXT NOT NULL,
  audio_blob BLOB,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'transcribing', 'confirmed', 'failed')),
  raw_text TEXT,
  display_text TEXT,
  language TEXT,
  provider TEXT,
  confidence REAL,
  speaker_label TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  corrected_by_user INTEGER NOT NULL DEFAULT 0,
  corrected_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, sequence),
  FOREIGN KEY (discussion_id) REFERENCES discussion_captures(id) ON DELETE CASCADE
);

CREATE TABLE discussion_organizations (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  input_transcript_sha256 TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  organization_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER, transcript_revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE (discussion_id, revision),
  FOREIGN KEY (discussion_id) REFERENCES discussion_captures(id) ON DELETE CASCADE
);

CREATE TABLE project_milestones (
  milestone_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  target_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE project_updates (
  update_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  health TEXT NOT NULL CHECK (health IN ('unknown', 'on_track', 'at_risk', 'off_track')),
  summary TEXT NOT NULL,
  progress_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  next_steps_json TEXT NOT NULL DEFAULT '[]',
  actor_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  creation_idempotency_key TEXT,
  project_id TEXT,
  milestone_id TEXT,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  phase TEXT NOT NULL CHECK (phase IN ('backlog', 'ready', 'active', 'review', 'closed')),
  resolution TEXT CHECK (resolution IS NULL OR resolution IN ('done', 'cancelled', 'duplicate', 'wont_do')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  due_at INTEGER,
  owner_id TEXT,
  delegate_agent_id TEXT,
  source TEXT NOT NULL,
  locale TEXT CHECK (locale IS NULL OR locale IN ('en', 'zh')),
  latest_contract_version INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER, board_rank INTEGER NOT NULL DEFAULT 0, manual_phase_revision INTEGER NOT NULL DEFAULT 0, automatic_phase_revision INTEGER NOT NULL DEFAULT 0,
  CHECK ((phase = 'closed' AND resolution IS NOT NULL) OR (phase <> 'closed' AND resolution IS NULL)),
  CHECK (parent_task_id IS NULL OR parent_task_id <> task_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL,
  FOREIGN KEY (milestone_id) REFERENCES project_milestones(milestone_id) ON DELETE SET NULL,
  FOREIGN KEY (parent_task_id) REFERENCES tasks(task_id) ON DELETE SET NULL
);

CREATE TABLE task_contracts (
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  objective TEXT NOT NULL,
  expected_outputs_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  approval_required_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  risks_json TEXT NOT NULL DEFAULT '[]',
  acceptance_policy TEXT NOT NULL DEFAULT 'verified_then_review'
    CHECK (acceptance_policy IN ('verified_auto', 'verified_then_review', 'manual')),
  output_destinations_json TEXT NOT NULL DEFAULT '[]',
  created_by_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, version),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE task_criterion_reviews (
  task_id TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  criterion_index INTEGER NOT NULL,
  criterion_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  note TEXT,
  reviewed_by_json TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, contract_version, criterion_index),
  FOREIGN KEY (task_id, contract_version) REFERENCES task_contracts(task_id, version) ON DELETE CASCADE
);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  dependency_kind TEXT NOT NULL DEFAULT 'blocks',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE task_sessions (
  task_session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  "conversation_id" TEXT,
  role TEXT NOT NULL CHECK (role IN ('primary', 'discussion', 'execution')),
  created_at INTEGER NOT NULL, agent_id TEXT, run_id TEXT, assignment_epoch INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('active', 'completed', 'superseded', 'failed')), started_at INTEGER, ended_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY ("conversation_id") REFERENCES sessions("conversation_id") ON DELETE SET NULL
);

CREATE TABLE task_waits (
  wait_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_run_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'dependency', 'user_input', 'approval', 'external_event',
    'scheduled_time', 'retry_backoff', 'paused'
  )),
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'cancelled')),
  reason TEXT NOT NULL,
  condition_json TEXT NOT NULL DEFAULT '{}',
  resume_at INTEGER,
  resolved_by_json TEXT,
  resolution_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE task_authority_grants (
  grant_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  granted_by_json TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

CREATE TABLE context_edges (
  edge_id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('project', 'task')),
  owner_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('input', 'reference', 'constraint', 'deliverable', 'evidence')),
  title TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  retrieval_policy_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_kind, owner_id, target_kind, target_id, role)
);

CREATE TABLE task_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  root_run_id TEXT NOT NULL,
  parent_run_id TEXT,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'waiting', 'verifying', 'succeeded', 'failed', 'cancelled'
  )),
  executor_kind TEXT NOT NULL CHECK (executor_kind IN ('agent', 'human', 'external')),
  executor_ref_json TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  contract_version INTEGER NOT NULL,
  context_snapshot_id TEXT,
  policy_snapshot_json TEXT,
  "conversation_id" TEXT,
  queued_at INTEGER NOT NULL,
  scheduled_at INTEGER,
  started_at INTEGER,
  heartbeat_at INTEGER,
  completed_at INTEGER,
  timeout_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  retry_policy_json TEXT NOT NULL DEFAULT '{}',
  retry_of_run_id TEXT,
  terminal_code TEXT,
  terminal_message TEXT,
  version INTEGER NOT NULL DEFAULT 1, manual_phase_revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (root_run_id) REFERENCES task_runs(run_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (parent_run_id) REFERENCES task_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (retry_of_run_id) REFERENCES task_runs(run_id) ON DELETE SET NULL,
  FOREIGN KEY (context_snapshot_id) REFERENCES context_snapshots(snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY ("conversation_id") REFERENCES sessions("conversation_id") ON DELETE SET NULL,
  FOREIGN KEY (task_id, contract_version) REFERENCES task_contracts(task_id, version) ON DELETE RESTRICT
);

CREATE TABLE task_run_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  actor_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  UNIQUE(run_id, sequence),
  FOREIGN KEY (run_id) REFERENCES task_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE task_run_receipts (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  summary TEXT NOT NULL,
  changes_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  verification_json TEXT NOT NULL DEFAULT '{"status":"unverified","checks":[]}',
  remaining_work_json TEXT NOT NULL DEFAULT '[]',
  next_action TEXT,
  needs_user INTEGER NOT NULL DEFAULT 0 CHECK (needs_user IN (0, 1)),
  completion_verdict TEXT CHECK (completion_verdict IS NULL OR completion_verdict IN ('achieved', 'partial', 'not_achieved')),
  failure_json TEXT,
  judgment_json TEXT,
  context_trace_id TEXT,
  finalized_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES task_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE task_run_feedback (
  feedback_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('helpful', 'not_helpful')),
  reason TEXT,
  needs_correction INTEGER CHECK (needs_correction IN (0, 1)),
  support_fit INTEGER CHECK (support_fit IN (0, 1)),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES task_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE command_deduplication (
  idempotency_key TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE domain_outbox (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
, operation_id TEXT);

CREATE TABLE connector_sync_policies (
  account_id                  TEXT PRIMARY KEY REFERENCES connector_accounts(id) ON DELETE CASCADE,
  scan_enabled               INTEGER NOT NULL DEFAULT 1 CHECK(scan_enabled IN (0, 1)),
  interval_minutes           INTEGER CHECK(interval_minutes IS NULL OR interval_minutes BETWEEN 5 AND 1440),
  revision                   INTEGER NOT NULL DEFAULT 1,
  updated_at                 INTEGER NOT NULL
);

CREATE TABLE endpoint_tool_invocations (
  id                    TEXT PRIMARY KEY,
  principal_id          TEXT NOT NULL,
  endpoint_id           TEXT NOT NULL,
  tool_call_id          TEXT NOT NULL,
  tool_name             TEXT NOT NULL,
  effect                TEXT NOT NULL CHECK(effect IN ('read', 'write', 'destructive')),
  confirmation_required INTEGER NOT NULL CHECK(confirmation_required IN (0, 1)),
  arguments_sha256      TEXT NOT NULL,
  status                TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
  error_code            TEXT,
  error_message         TEXT,
  started_at            INTEGER NOT NULL,
  completed_at          INTEGER
);

CREATE TABLE collaboration_rule_revisions (
  revision_id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES collaboration_rules(rule_id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by = 'user'),
  created_at INTEGER NOT NULL
);

CREATE TABLE context_evidence (
  evidence_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('conversation', 'connector', 'user', 'runtime')),
  source_instance_id TEXT,
  source_ref TEXT NOT NULL,
  redacted_excerpt TEXT,
  trust_level TEXT NOT NULL CHECK (trust_level IN ('owner', 'trusted', 'untrusted')),
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
, source_run_id TEXT, source_item_id TEXT, conversation_id TEXT, turn_id TEXT, message_id TEXT, content_hash TEXT, retention_policy TEXT, processing_policy TEXT, extractor_id TEXT, extractor_version TEXT, ingested_at INTEGER);

CREATE TABLE understanding_source_grants (
  grant_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  adapter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'files', 'recent_documents', 'calendar', 'tasks', 'notes',
    'mail', 'messages', 'code_activity'
  )),
  platform TEXT NOT NULL CHECK (platform IN ('darwin', 'win32', 'linux', 'all')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('once', 'continuous')),
  retention_policy TEXT NOT NULL CHECK (retention_policy IN ('metadata_only', 'derived_only', 'bounded_raw')),
  processing_policy TEXT NOT NULL CHECK (processing_policy IN ('local_only', 'remote_allowed')),
  config_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  last_collected_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE understanding_source_runs (
  run_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'bootstrap', 'incremental', 'fingerprint')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'canceled')),
  cursor_before TEXT,
  cursor_after TEXT,
  items_seen INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER, connector_learning_job_id TEXT,
  FOREIGN KEY (grant_id) REFERENCES understanding_source_grants(grant_id) ON DELETE CASCADE
);

CREATE TABLE "work_understanding_evidence" (
  evidence_id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  source_grant_id TEXT,
  project_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'file', 'git', 'project_metadata', 'understanding_source', 'session', 'user_statement'
  )),
  source_ref TEXT NOT NULL,
  observation TEXT NOT NULL,
  content_hash TEXT,
  observed_at INTEGER,
  collected_at INTEGER NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'restricted')),
  FOREIGN KEY (investigation_id) REFERENCES work_understanding_investigations(investigation_id) ON DELETE CASCADE,
  FOREIGN KEY (source_grant_id) REFERENCES understanding_source_grants(grant_id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

CREATE TABLE task_conversation_state (
  task_id TEXT PRIMARY KEY,
  "active_conversation_id" TEXT,
  current_executor_agent_id TEXT,
  assignment_epoch INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'active')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY ("active_conversation_id") REFERENCES sessions("conversation_id") ON DELETE SET NULL
);

CREATE TABLE task_handoff_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  "from_conversation_id" TEXT,
  "to_conversation_id" TEXT NOT NULL,
  from_agent_id TEXT,
  to_agent_id TEXT NOT NULL,
  assignment_epoch INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY ("from_conversation_id") REFERENCES sessions("conversation_id") ON DELETE SET NULL,
  FOREIGN KEY ("to_conversation_id") REFERENCES sessions("conversation_id") ON DELETE CASCADE
);

CREATE TABLE "session_config" (
  "conversation_id" TEXT PRIMARY KEY,
  thinking_level TEXT,
  reasoning_level TEXT,
  verbose_level TEXT,
  elevated_mode TEXT,
  model_override TEXT,
  provider_override TEXT,
  working_directory_override TEXT,
  response_language TEXT,
  user_context_mode TEXT CHECK (user_context_mode IN ('enabled', 'off', 'temporary')),
  updated_at INTEGER NOT NULL, fixed_model INTEGER NOT NULL DEFAULT 0 CHECK (fixed_model IN (0, 1)),
  FOREIGN KEY ("conversation_id") REFERENCES sessions("conversation_id") ON DELETE CASCADE
);

CREATE TABLE context_extraction_runs (
  extraction_run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  extractor_id TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  processing_policy TEXT NOT NULL CHECK (processing_policy IN ('local_only', 'remote_allowed')),
  destination TEXT NOT NULL CHECK (destination IN ('deterministic', 'local_model', 'remote_model')),
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'skipped', 'failed')),
  error_code TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (principal_id, source_ref, extractor_id, extractor_version)
);

CREATE TABLE user_people (
  person_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  user_display_name TEXT,
  inferred_kind TEXT NOT NULL CHECK (inferred_kind IN ('person', 'bot', 'service', 'group', 'unknown')),
  user_kind TEXT CHECK (user_kind IS NULL OR user_kind IN ('person', 'bot', 'service', 'group', 'unknown')),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  merged_into_person_id TEXT REFERENCES user_people(person_id) ON DELETE SET NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_person_handles (
  handle_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES user_people(person_id) ON DELETE CASCADE,
  handle_type TEXT NOT NULL CHECK (handle_type IN ('email', 'provider_user', 'username', 'display_name')),
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL,
  source_instance_id TEXT NOT NULL,
  verification TEXT NOT NULL CHECK (verification IN ('observed', 'inferred', 'user_confirmed')),
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(handle_type, normalized_value, source_instance_id)
);

CREATE TABLE user_person_source_stats (
  person_id TEXT NOT NULL REFERENCES user_people(person_id) ON DELETE CASCADE,
  source_instance_id TEXT NOT NULL,
  interaction_count INTEGER NOT NULL CHECK (interaction_count >= 0),
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  last_source_item_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(person_id, source_instance_id)
);

CREATE TABLE user_people_index_state (
  principal_id TEXT PRIMARY KEY,
  source_change_sequence INTEGER NOT NULL,
  source_grants_updated_at INTEGER NOT NULL,
  rebuilt_at INTEGER NOT NULL
);

CREATE TABLE notification_events (
  event_id              TEXT PRIMARY KEY,
  dedupe_key            TEXT NOT NULL UNIQUE,
  event_type            TEXT NOT NULL,
  target_json           TEXT NOT NULL,
  priority              TEXT NOT NULL CHECK (priority IN ('normal', 'high')),
  title_en              TEXT NOT NULL,
  title_zh              TEXT NOT NULL,
  body_en               TEXT,
  body_zh               TEXT,
  payload_json          TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL
);

CREATE TABLE notification_acknowledgements (
  event_id              TEXT NOT NULL,
  consumer_id           TEXT NOT NULL,
  surface               TEXT NOT NULL CHECK (surface IN ('web', 'electron', 'mobile')),
  acknowledged_at       INTEGER NOT NULL,
  PRIMARY KEY (event_id, consumer_id),
  FOREIGN KEY (event_id) REFERENCES notification_events(event_id) ON DELETE CASCADE
);

CREATE TABLE gateway_identity (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  gateway_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE execution_environments (
  environment_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('local_checkout', 'managed_worktree')),
  status TEXT NOT NULL CHECK (status IN (
    'requested', 'provisioning', 'ready', 'degraded', 'deleting', 'deleted', 'error'
  )),
  root_path TEXT NOT NULL CHECK (length(root_path) > 0),
  repository_root TEXT,
  git_common_dir TEXT,
  base_ref TEXT,
  base_sha TEXT,
  branch_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  deleted_at INTEGER
, ownership TEXT NOT NULL DEFAULT 'registered'
  CHECK (ownership IN ('registered', 'xopc_created')));

CREATE TABLE execution_environment_bindings (
  binding_id TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL,
  environment_id TEXT NOT NULL REFERENCES execution_environments(environment_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  released_at INTEGER
);

CREATE TABLE execution_environment_events (
  event_id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES execution_environments(environment_id) ON DELETE CASCADE,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN (
    'requested', 'provisioning', 'ready', 'degraded', 'deleting', 'deleted', 'error'
  )),
  to_status TEXT NOT NULL CHECK (to_status IN (
    'requested', 'provisioning', 'ready', 'degraded', 'deleting', 'deleted', 'error'
  )),
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE durable_state (
  namespace TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  UNIQUE(namespace, scope, key)
);

CREATE TABLE note_snapshots (
  note_id TEXT NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(note_id, timestamp)
);

CREATE TABLE durable_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  queue TEXT NOT NULL,
  scope TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  enqueued_at INTEGER NOT NULL,
  processed_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER,
  UNIQUE(queue, scope, id)
);

CREATE TABLE user_assertion_slots (
  slot_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user', 'person', 'goal', 'project', 'topic')),
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  cardinality TEXT NOT NULL CHECK(cardinality IN ('single', 'multiple')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_assertions (
  assertion_id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES user_assertion_slots(slot_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN (
    'identity', 'preference', 'value', 'routine', 'capability',
    'relationship', 'current_state', 'derived_insight'
  )),
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  normalized_value TEXT NOT NULL,
  statement TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN (
    'user_explicit', 'user_observed', 'system_inferred', 'external_untrusted'
  )),
  status TEXT NOT NULL CHECK(status IN (
    'candidate', 'active', 'needs_review', 'conflicted', 'stale', 'archived', 'rejected'
  )),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  declared_importance REAL CHECK(declared_importance IS NULL OR (declared_importance >= 0 AND declared_importance <= 1)),
  inferred_importance REAL NOT NULL CHECK(inferred_importance >= 0 AND inferred_importance <= 1),
  consequence TEXT NOT NULL CHECK(consequence IN ('low', 'medium', 'high', 'critical')),
  actionability REAL NOT NULL CHECK(actionability >= 0 AND actionability <= 1),
  volatility TEXT NOT NULL CHECK(volatility IN ('stable', 'slow', 'dynamic', 'event')),
  sensitivity TEXT NOT NULL CHECK(sensitivity IN ('normal', 'personal', 'secret', 'regulated')),
  disclosure_policy TEXT NOT NULL CHECK(disclosure_policy IN ('silent', 'referenceable', 'ask_before_reference')),
  applicability_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(applicability_json)),
  valid_from INTEGER,
  valid_to INTEGER,
  observed_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  review_at INTEGER,
  supersedes_assertion_id TEXT REFERENCES user_assertions(assertion_id) ON DELETE SET NULL,
  created_by TEXT NOT NULL CHECK(created_by IN ('user', 'runtime', 'connector', 'maintenance', 'migration')),
  created_at INTEGER NOT NULL, domain TEXT NOT NULL DEFAULT 'identity'
  CHECK(domain IN (
    'identity', 'life_history', 'health', 'emotion', 'personality', 'cognition',
    'values', 'motivation', 'goals', 'capabilities', 'behavior', 'preferences',
    'relationships', 'resources_constraints', 'environment', 'digital_life'
  )), model_layer TEXT NOT NULL DEFAULT 'fact'
  CHECK(model_layer IN ('fact', 'pattern', 'interpretation')), sensitivity_categories_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(sensitivity_categories_json)), purpose_ids_json TEXT NOT NULL DEFAULT '["personalization"]'
  CHECK(json_valid(purpose_ids_json)), allowed_uses_json TEXT NOT NULL DEFAULT '["answer","rank","recommend"]'
  CHECK(json_valid(allowed_uses_json)), allowed_agent_ids_json TEXT CHECK(allowed_agent_ids_json IS NULL OR json_valid(allowed_agent_ids_json)), consent_receipt_id TEXT, support_count INTEGER NOT NULL DEFAULT 0 CHECK(support_count >= 0), independent_source_count INTEGER NOT NULL DEFAULT 0 CHECK(independent_source_count >= 0), last_supported_at INTEGER, delete_after INTEGER,
  CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE VIRTUAL TABLE user_assertions_fts USING fts5(
  statement,
  assertion_id UNINDEXED,
  slot_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE user_assertion_evidence (
  assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('supports', 'contradicts', 'supersedes')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at INTEGER NOT NULL, content_hash TEXT,
  PRIMARY KEY(assertion_id, evidence_id, relation)
);

CREATE TABLE user_assertion_status_events (
  event_id TEXT PRIMARY KEY,
  assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'runtime', 'maintenance', 'migration')),
  reason TEXT NOT NULL,
  source_run_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_goals (
  goal_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  parent_goal_id TEXT REFERENCES user_goals(goal_id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed', 'active', 'paused', 'achieved', 'abandoned')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  declared_importance REAL CHECK(declared_importance IS NULL OR (declared_importance >= 0 AND declared_importance <= 1)),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'user_observed', 'system_inferred', 'external_untrusted')),
  target_at INTEGER,
  valid_from INTEGER,
  valid_to INTEGER,
  review_at INTEGER,
  current_revision_id TEXT NOT NULL REFERENCES user_goal_revisions(revision_id) DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_goal_revisions (
  revision_id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES user_goals(goal_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  desired_outcome TEXT NOT NULL,
  success_criteria_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(success_criteria_json)),
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE SET NULL,
  created_by TEXT NOT NULL CHECK(created_by IN ('user', 'runtime', 'connector', 'maintenance', 'migration')),
  change_reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_priority_windows (
  priority_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('goal', 'project', 'task', 'assertion', 'topic')),
  target_id TEXT NOT NULL,
  rank TEXT NOT NULL CHECK(rank IN ('primary', 'secondary', 'background')),
  declared_importance REAL CHECK(declared_importance IS NULL OR (declared_importance >= 0 AND declared_importance <= 1)),
  urgency REAL NOT NULL CHECK(urgency >= 0 AND urgency <= 1),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER NOT NULL,
  review_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed', 'expired')),
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(valid_to >= valid_from)
);

CREATE TABLE memory_maintenance_runs (
  run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK(job_type IN ('temporal_sweep', 'daily_reconciliation', 'weekly_knowledge', 'manual_repair')),
  idempotency_key TEXT NOT NULL UNIQUE,
  algorithm_version TEXT NOT NULL,
  config_snapshot_json TEXT NOT NULL CHECK(json_valid(config_snapshot_json)),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(cursor_json)),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metrics_json)),
  error_message TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE memory_maintenance_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES memory_maintenance_runs(run_id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK(object_type IN ('assertion', 'goal', 'priority', 'knowledge', 'evidence', 'index')),
  object_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE execution_context_runs (
  run_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  turn_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  as_of INTEGER NOT NULL,
  budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
  metrics_json TEXT NOT NULL CHECK(json_valid(metrics_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE execution_context_items (
  run_id TEXT NOT NULL REFERENCES execution_context_runs(run_id) ON DELETE CASCADE,
  object_type TEXT NOT NULL CHECK(object_type IN ('rule', 'assertion', 'goal', 'priority', 'knowledge')),
  object_id TEXT NOT NULL,
  score REAL,
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reasons_json)),
  included INTEGER NOT NULL CHECK(included IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, object_type, object_id)
);

CREATE TABLE execution_context_feedback (
  turn_id TEXT PRIMARY KEY REFERENCES execution_context_runs(turn_id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK(rating IN ('helpful', 'irrelevant')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE session_connection_waits (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "transcript_id" TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','queued','closed')),
  version INTEGER NOT NULL,
  data_json TEXT NOT NULL
);

CREATE TABLE session_clarification_waits (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "transcript_id" TEXT NOT NULL,
  origin_run_id TEXT NOT NULL,
  origin_tool_call_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'open', 'queued', 'resolved', 'expired', 'cancelled', 'superseded'
  )),
  version INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE("transcript_id", origin_run_id, origin_tool_call_id)
);

CREATE TABLE "session_inputs" (
  id TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  requested_delivery TEXT NOT NULL CHECK (requested_delivery IN ('next', 'steer')),
  effective_delivery TEXT NOT NULL CHECK (effective_delivery IN ('next', 'steer')),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'injecting',
    'completed', 'cancelled', 'failed', 'interrupted', 'suspended'
  )),
  content TEXT NOT NULL,
  attachments_json TEXT,
  thinking TEXT,
  origin_json TEXT NOT NULL,
  position INTEGER NOT NULL,
  target_run_id TEXT,
  run_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  "expected_transcript_id" TEXT,
  context_refs_json TEXT,
  context_snapshots_json TEXT,
  kind TEXT NOT NULL DEFAULT 'message' CHECK (
    kind IN ('message', 'connection_resume', 'clarification_resume')
  ),
  payload_json TEXT,
  task_run_id TEXT, interrupt_requested INTEGER NOT NULL DEFAULT 0 CHECK(interrupt_requested IN (0, 1)),
  UNIQUE("conversation_id", client_message_id)
);

CREATE TABLE device_refresh_credentials (
  credential_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  replaced_by TEXT REFERENCES device_refresh_credentials(credential_id),
  rotation_request_id TEXT,
  revoked_at INTEGER
);

CREATE TABLE device_access_sessions (
  session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE browser_tab_bindings (
  binding_id TEXT PRIMARY KEY,
  "conversation_id" TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  url_origin TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('read', 'act')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE endpoint_principals (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK(kind IN ('web', 'desktop', 'mobile', 'browser')),
  display_name TEXT NOT NULL,
  platform     TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);

CREATE TABLE endpoint_instance_bindings (
  endpoint_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES endpoint_principals(id),
  bound_at INTEGER NOT NULL
);

CREATE TABLE endpoint_session_bindings (
  "conversation_id" TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES endpoint_instance_bindings(endpoint_id),
  bound_at INTEGER NOT NULL
);

CREATE TABLE browser_sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  auth_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE device_pairing_sessions (
  pairing_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  routes_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts_remaining INTEGER NOT NULL CHECK (attempts_remaining >= 0),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  enrollment_issuer TEXT,
  enrollment_extension_id TEXT,
  enrollment_public_key_thumbprint TEXT,
  enrollment_nonce TEXT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('mobile', 'browser'))
);

CREATE TABLE device_pairing_requests (
  request_id TEXT PRIMARY KEY,
  pairing_id TEXT NOT NULL UNIQUE REFERENCES device_pairing_sessions(pairing_id) ON DELETE CASCADE,
  device_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'cancelled', 'expired')),
  revision INTEGER NOT NULL DEFAULT 1,
  confirmation_code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  recovery_until INTEGER NOT NULL,
  completion_key TEXT,
  initial_token_hash TEXT,
  device_id TEXT REFERENCES devices(device_id),
  created_at INTEGER NOT NULL
);

CREATE TABLE discussion_recording_chunks (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  PRIMARY KEY(discussion_id, sequence)
);

CREATE TABLE discussion_transcript_revisions (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  segments_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(discussion_id, revision)
);

CREATE TABLE discussion_analysis_chunks (discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY (discussion_id, input_hash));

CREATE TABLE discussion_action_tasks (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  organization_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(discussion_id, action_id)
);

CREATE TABLE discussion_edits (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('summary', 'decisions', 'actionItems', 'risks', 'openQuestions')),
  item_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, kind, item_id)
);

CREATE TABLE discussion_recording_jobs (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL UNIQUE REFERENCES discussion_captures(id) ON DELETE CASCADE,
  input_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  lease_owner TEXT,
  lease_until INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE capability_imports (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('scan', 'plan', 'job', 'run')),
  created_at INTEGER NOT NULL,
  idempotency_key TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE import_selections (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inventory', 'run')),
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE conversation_routes (
    route_key TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES sessions("conversation_id") ON DELETE CASCADE
  );

CREATE VIRTUAL TABLE "transcript_fts" USING fts5(
    content, conversation_id UNINDEXED, transcript_id UNINDEXED, entry_id UNINDEXED, tokenize='unicode61'
  );

CREATE TABLE "devices" (
  device_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'harmonyos', 'chrome')),
  extension_id TEXT CHECK (extension_id IS NULL OR length(extension_id) = 32),
  public_key_jwk TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER, request_proof_version INTEGER NOT NULL DEFAULT 1 CHECK(request_proof_version = 1),
  CHECK ((platform = 'chrome') = (extension_id IS NOT NULL))
);

CREATE TABLE "device_push_endpoints" (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'harmonyos')),
  push_token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  permissions TEXT NOT NULL CHECK (permissions IN ('granted', 'denied', 'unknown')),
  preferences_json TEXT NOT NULL DEFAULT '{}',
  locale TEXT NOT NULL CHECK (locale IN ('en', 'zh')),
  app_version TEXT,
  lease_expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE connector_objective_accounts (
  conversation_id TEXT NOT NULL,
  transcript_id TEXT NOT NULL,
  objective_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY(conversation_id, transcript_id, objective_id, connector_id, account_id)
);

CREATE TABLE connector_authorization_attempts (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  backend_id TEXT,
  connection_id TEXT NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  expected_account_id TEXT,
  authorization_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('awaiting_user','succeeded','failed','expired')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE connector_runtime_identity (id INTEGER PRIMARY KEY CHECK(id = 1), installation_id TEXT NOT NULL);

CREATE TABLE memory_suppressions (
  fingerprint TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE understanding_refresh_batches (
  batch_id TEXT PRIMARY KEY,
  source_run_ids_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sidebar_layouts (
  container_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sidebar_positions (
  container_id TEXT NOT NULL REFERENCES sidebar_layouts(container_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (container_id, item_id),
  UNIQUE (container_id, position)
);

CREATE TABLE connector_cli_authorizations (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  expected_account_id TEXT,
  context_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('preparing','awaiting_user','verifying','succeeded','failed','expired','cancelled')),
  challenge_json TEXT,
  error TEXT,
  account_id TEXT,
  owner_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE connector_cli_executions (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','success','failed','unknown')),
  owner_id TEXT NOT NULL,
  error_kind TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE capability_operations (
  operation_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  descriptor_digest TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'succeeded'
  CHECK (state IN ('running', 'succeeded', 'failed', 'unknown')), generation INTEGER NOT NULL DEFAULT 1, recovery_mode TEXT NOT NULL DEFAULT 'atomic'
  CHECK (recovery_mode IN ('atomic', 'manual', 'provider-idempotent')), lease_expires_at INTEGER, evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  UNIQUE(principal_id, capability_id, idempotency_key)
);

CREATE TABLE capability_invocations (
  invocation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES capability_operations(operation_id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  replayed INTEGER NOT NULL CHECK (replayed IN (0, 1)),
  created_at INTEGER NOT NULL
, state TEXT NOT NULL DEFAULT 'succeeded'
  CHECK (state IN ('running', 'succeeded', 'failed', 'unknown')), finished_at INTEGER);

CREATE TABLE note_file_cleanup (
  note_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, relative_path)
);

CREATE TABLE automation_deleted_revisions (
  automation_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

CREATE TABLE automation_run_requests (
  run_id TEXT PRIMARY KEY,
  automation_json TEXT NOT NULL CHECK (json_valid(automation_json))
);

CREATE TABLE note_deletion_cleanup (
  kind TEXT NOT NULL CHECK(kind IN ('media', 'share')),
  object_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(kind, object_id)
);

CREATE TABLE project_workspace_creation (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  workspace_root TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE knowledge_items (
  knowledge_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'work_thread', 'project_fact', 'workspace_fact', 'decision', 'task_lesson',
    'commitment', 'open_question', 'episode', 'note'
  )),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  content TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL CHECK(importance >= 0 AND importance <= 1),
  valid_from INTEGER,
  valid_to INTEGER,
  expires_at INTEGER,
  review_at INTEGER,
  origin_class TEXT NOT NULL CHECK(origin_class IN ('owner', 'agent', 'system', 'untrusted')),
  source_agent_id TEXT,
  source_conversation_id TEXT,
  source_turn_id TEXT,
  derived_from_recalled_context INTEGER NOT NULL DEFAULT 0 CHECK(derived_from_recalled_context IN (0, 1)),
  source_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  record_class TEXT NOT NULL DEFAULT 'memory' CHECK(record_class IN ('memory', 'source_index')), claim_mode TEXT NOT NULL DEFAULT 'observed'
  CHECK (claim_mode IN ('explicit', 'observed', 'inferred', 'reported')), verification TEXT NOT NULL DEFAULT 'supported'
  CHECK (verification IN ('supported', 'tentative', 'conflicted')), sensitivity TEXT NOT NULL DEFAULT 'normal'
  CHECK (sensitivity IN ('normal', 'personal', 'secret', 'regulated')),
  CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE knowledge_item_status_events (
  event_id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'agent', 'runtime', 'maintenance', 'migration')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE context_extraction_outputs (
  output_id TEXT PRIMARY KEY,
  extraction_run_id TEXT NOT NULL REFERENCES context_extraction_runs(extraction_run_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  candidate_key TEXT NOT NULL,
  object_type TEXT CHECK (object_type IN ('assertion', 'rule', 'goal', 'knowledge')),
  object_id TEXT,
  version_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('created', 'deduplicated', 'rejected')),
  created_at INTEGER NOT NULL,
  UNIQUE (extraction_run_id, ordinal)
);

CREATE TABLE chat_previews (
  preview_id       TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  preferred_height INTEGER NOT NULL CHECK (preferred_height BETWEEN 240 AND 720),
  latest_revision  TEXT NOT NULL CHECK (length(latest_revision) = 64),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE chat_preview_revisions (
  preview_id  TEXT NOT NULL REFERENCES chat_previews(preview_id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  markup      TEXT NOT NULL,
  styles      TEXT NOT NULL,
  script      TEXT NOT NULL,
  promoted_app_id TEXT UNIQUE REFERENCES local_apps(app_id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (preview_id, source_hash)
);

CREATE TABLE "context_snapshots" (
  snapshot_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('task_run', 'task', 'session')),
  owner_id TEXT NOT NULL,
  conversation_id TEXT,
  query TEXT NOT NULL,
  selected_items_json TEXT NOT NULL DEFAULT '[]',
  rejected_items_json TEXT NOT NULL DEFAULT '[]',
  consent_requests_json TEXT NOT NULL DEFAULT '[]',
  relationship_policy_json TEXT NOT NULL DEFAULT '{}',
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  allocation_json TEXT,
  authorization_snapshot_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES sessions(conversation_id) ON DELETE SET NULL
);

CREATE TABLE "collaboration_rules" (
  rule_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('communication', 'execution', 'boundary', 'routine', 'initiative')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'archived')),
  priority INTEGER NOT NULL DEFAULT 100,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'workspace', 'project', 'session')),
  scope_id TEXT,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  current_revision_id TEXT NOT NULL REFERENCES collaboration_rule_revisions(revision_id)
    DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE home_advice_generations (
  generation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'skipped', 'retry_wait', 'failed', 'cancelled')),
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reasons_json)),
  requested_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  retry_at INTEGER,
  lease_owner TEXT,
  lease_until INTEGER,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  dirty_after_start INTEGER NOT NULL DEFAULT 0 CHECK(dirty_after_start IN (0, 1)),
  snapshot_hash TEXT,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_ids_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  model_ref TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  outcome_reason TEXT,
  error_code TEXT
, strategy_version TEXT NOT NULL DEFAULT 'home-v1');

CREATE TABLE home_opportunity_projections (
  opportunity_id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL REFERENCES home_advice_generations(generation_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 0 AND 2),
  kind TEXT NOT NULL CHECK(kind IN ('project_next_step', 'delivery_risk', 'meeting_prep', 'commitment_follow_up', 'automation_candidate')),
  project_id TEXT,
  dedupe_key TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_refs_json)),
  snapshot_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active', 'snoozed', 'accepted', 'discussing', 'dismissed', 'expired', 'superseded')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  snoozed_until INTEGER,
  resolution_kind TEXT CHECK(resolution_kind IS NULL OR resolution_kind IN ('session', 'task')),
  resolution_ref TEXT
);

CREATE TABLE home_opportunity_feedback (
  feedback_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES home_opportunity_projections(opportunity_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('started', 'discussed', 'already_done', 'irrelevant', 'too_early', 'source_incorrect', 'less_like_this', 'snoozed')),
  reason_code TEXT,
  note TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(scope_json)),
  created_at INTEGER NOT NULL
);

CREATE TABLE agent_catalog_settings (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  default_agent_id TEXT NOT NULL REFERENCES agents(id),
  defaults_json TEXT NOT NULL CHECK(json_valid(defaults_json)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  workspace_override TEXT,
  profile_json TEXT CHECK(profile_json IS NULL OR json_valid(profile_json)),
  overrides_json TEXT NOT NULL CHECK(json_valid(overrides_json)),
  provisioning_state TEXT NOT NULL CHECK(provisioning_state IN ('pending', 'ready', 'error')),
  provisioning_error TEXT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE agent_bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  position INTEGER NOT NULL CHECK(position >= 0),
  rule_json TEXT NOT NULL CHECK(json_valid(rule_json)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(position)
);

CREATE TABLE agent_surface_defaults (
  surface TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE agent_provisioning_jobs (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK(operation IN ('provision', 'purge')),
  state TEXT NOT NULL CHECK(state IN ('pending', 'running', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE understanding_consent_receipts (
  receipt_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES understanding_source_grants(grant_id) ON DELETE CASCADE,
  purposes_json TEXT NOT NULL CHECK(json_valid(purposes_json)),
  allowed_domains_json TEXT NOT NULL CHECK(json_valid(allowed_domains_json)),
  denied_domains_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(denied_domains_json)),
  allowed_fields_json TEXT NOT NULL CHECK(json_valid(allowed_fields_json)),
  access_mode TEXT NOT NULL CHECK(access_mode IN ('once', 'continuous')),
  lookback_days INTEGER NOT NULL CHECK(lookback_days >= 0),
  raw_retention_days INTEGER NOT NULL CHECK(raw_retention_days >= 0),
  processing_policy TEXT NOT NULL CHECK(processing_policy IN ('local_only', 'remote_allowed')),
  allowed_agent_ids_json TEXT CHECK(allowed_agent_ids_json IS NULL OR json_valid(allowed_agent_ids_json)),
  disclosure_version TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE user_model_observations (
  observation_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK(domain IN (
    'identity', 'life_history', 'health', 'emotion', 'personality', 'cognition',
    'values', 'motivation', 'goals', 'capabilities', 'behavior', 'preferences',
    'relationships', 'resources_constraints', 'environment', 'digital_life'
  )),
  observation_type TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('user', 'person', 'goal', 'project', 'topic')),
  subject_id TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json)),
  sensitivity_categories_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(sensitivity_categories_json)),
  owner_attribution TEXT NOT NULL CHECK(owner_attribution IN ('user', 'other', 'shared', 'unknown')),
  observed_at INTEGER NOT NULL,
  valid_to INTEGER,
  delete_after INTEGER,
  source_grant_id TEXT REFERENCES understanding_source_grants(grant_id) ON DELETE CASCADE,
  source_item_id TEXT,
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(principal_id, content_hash)
);

CREATE TABLE user_assertion_edges (
  from_assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  to_assertion_id TEXT NOT NULL REFERENCES user_assertions(assertion_id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('supports', 'contradicts', 'derived_from', 'specializes')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(from_assertion_id, to_assertion_id, relation),
  CHECK(from_assertion_id <> to_assertion_id)
);

CREATE TABLE automation_event_deliveries (
  event_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'retrying', 'queued', 'completed', 'failed', 'cancelled', 'skipped', 'dead_letter')),
  run_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT,
  lease_owner TEXT,
  lease_until_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(event_id, automation_id),
  FOREIGN KEY(event_id) REFERENCES automation_events(event_id) ON DELETE CASCADE
);

CREATE TABLE automation_results (
  run_id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL UNIQUE,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES automation_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE "automations" (
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

CREATE TABLE "automation_events" (
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

CREATE TABLE "automation_result_deliveries" (
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

CREATE TABLE "ai_usage_events" (
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
, otel_trace_id TEXT, otel_span_id TEXT, cloud_request_id TEXT, cloud_billing_json TEXT
  CHECK(cloud_billing_json IS NULL OR json_valid(cloud_billing_json)));

CREATE TABLE "sessions" (
  conversation_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  active_transcript_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  name TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  session_started_at INTEGER,
  last_interaction_at INTEGER,
  source_channel TEXT NOT NULL DEFAULT '',
  source_chat_id TEXT NOT NULL DEFAULT '',
  session_type TEXT,
  hidden_from_session_list INTEGER NOT NULL DEFAULT 0,
  parent_conversation_id TEXT,
  routing_json TEXT,
  custom_data_json TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  compacted_count INTEGER NOT NULL DEFAULT 0,
  last_flushed_at INTEGER,
  flush_count INTEGER NOT NULL DEFAULT 0,
  project_id TEXT
);

CREATE TABLE "connector_catalog_entries" (
  connector_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE "connector_installations" (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  allowed_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  max_scope TEXT NOT NULL DEFAULT 'read' CHECK(max_scope IN ('read', 'write', 'admin')),
  confirmation_policy TEXT NOT NULL DEFAULT 'writes'
    CHECK(confirmation_policy IN ('always', 'writes', 'admin', 'never')),
  selected_account_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(connector_id, principal_id)
);

CREATE TABLE "connector_accounts" (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  identity_key TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  current_connection_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  allowed_agent_ids_json TEXT,
  backend_id TEXT,
  runtime_instance_id TEXT
);

CREATE TABLE "connector_connections" (
  id TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES connector_installations(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  alias TEXT,
  identity_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK(status IN ('pending', 'active', 'expired', 'failed', 'revoked', 'disabled', 'unknown')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
  connected_at INTEGER,
  expires_at INTEGER,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  account_id TEXT REFERENCES connector_accounts(id) ON DELETE CASCADE
);

CREATE TABLE "connector_action_metadata" (
  connector_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  toolkit TEXT,
  scope TEXT NOT NULL DEFAULT 'write' CHECK(scope IN ('read', 'write', 'admin')),
  curated INTEGER NOT NULL DEFAULT 0 CHECK(curated IN (0, 1)),
  input_schema_json TEXT,
  schema_version TEXT,
  cached_at INTEGER NOT NULL,
  PRIMARY KEY(connector_id, action_id)
);

CREATE TABLE "connector_execution_audit" (
  id TEXT PRIMARY KEY,
  installation_id TEXT REFERENCES connector_installations(id) ON DELETE SET NULL,
  connection_id TEXT REFERENCES connector_connections(id) ON DELETE SET NULL,
  connector_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  agent_id TEXT,
  conversation_id TEXT,
  action_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('read', 'write', 'admin')),
  decision TEXT NOT NULL CHECK(decision IN ('allowed', 'denied', 'confirmation_required')),
  result_status TEXT NOT NULL CHECK(result_status IN ('success', 'error', 'not_executed')),
  duration_ms INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE "connector_approvals" (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  connection_id TEXT REFERENCES connector_connections(id) ON DELETE SET NULL,
  agent_id TEXT,
  conversation_id TEXT,
  action_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('read', 'write', 'admin')),
  arguments_hash TEXT NOT NULL,
  arguments_preview_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  consumed_at INTEGER,
  wait_id TEXT
);

CREATE TABLE "connector_webhook_deliveries" (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('pending', 'processing', 'processed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL,
  processing_at INTEGER,
  processed_at INTEGER,
  last_error TEXT
);

CREATE TABLE "user_trust_policies" (
  principal_id TEXT PRIMARY KEY,
  default_action_level TEXT NOT NULL DEFAULT 'confirm'
    CHECK(default_action_level IN ('observe', 'suggest', 'confirm', 'auto')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE "connector_backends" (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('managed', 'byok')),
  label TEXT NOT NULL,
  credential_ref TEXT,
  credential_source TEXT NOT NULL DEFAULT 'stored'
    CHECK(credential_source IN ('stored', 'environment')),
  verified_at INTEGER,
  active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE session_input_receipts (
  conversation_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  input_id TEXT,
  transcript_id TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, client_message_id)
);

CREATE TABLE session_tombstones (
  conversation_id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

CREATE TABLE session_preparation_retries (
  conversation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  principal_id TEXT NOT NULL,
  PRIMARY KEY (conversation_id, idempotency_key)
);

CREATE TABLE session_preparations (
  conversation_id TEXT PRIMARY KEY REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL UNIQUE,
  creation_json TEXT NOT NULL CHECK(json_valid(creation_json)),
  state TEXT NOT NULL CHECK(state IN ('preparing', 'ready', 'preparation_failed')),
  environment_id TEXT NOT NULL,
  base_commit TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE session_preparation_cleanup (
  environment_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  not_before INTEGER NOT NULL,
  last_error TEXT
);

CREATE TABLE task_origin_links (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
, origin_transcript_id TEXT, request_input_id TEXT);

CREATE TABLE task_collaboration_entries (
  entry_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  task_run_id TEXT REFERENCES task_runs(run_id) ON DELETE SET NULL,
  assignment_epoch INTEGER,
  sequence INTEGER NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('main_agent', 'worker_agent', 'user', 'system')),
  author_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'question', 'answer', 'instruction', 'ack', 'result', 'failure')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  causation_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, sequence),
  UNIQUE (task_id, idempotency_key)
);

CREATE TABLE task_collaboration_deliveries (
  entry_id TEXT PRIMARY KEY REFERENCES task_collaboration_entries(entry_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'confirmed', 'stale')),
  conversation_id TEXT,
  assignment_epoch INTEGER,
  client_message_id TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE task_main_agent_links (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  origin_conversation_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE personal_agent_onboarding (
  owner_id TEXT PRIMARY KEY,
  step TEXT NOT NULL,
  draft_json TEXT NOT NULL DEFAULT '{}',
  completed_at INTEGER,
  welcome_finished_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE task_run_outcomes (
  task_run_id TEXT NOT NULL REFERENCES task_runs(run_id) ON DELETE CASCADE,
  outcome_id TEXT NOT NULL,
  assignment_epoch INTEGER NOT NULL,
  outcome_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_run_id, outcome_id)
);

CREATE TABLE task_result_deliveries (
  delivery_id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL REFERENCES task_runs(run_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'stale', 'failed')),
  message_entry_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  notified_at INTEGER, reply_payload_json TEXT, reply_status TEXT CHECK(reply_status IN ('pending','generating','ready','delivered','stale')), reply_lease_token TEXT, reply_lease_until INTEGER NOT NULL DEFAULT 0, reply_text TEXT, reply_draft_transcript_id TEXT, reply_message_entry_id TEXT, reply_notified_at INTEGER, reply_attempts INTEGER NOT NULL DEFAULT 0, reply_next_attempt_at INTEGER NOT NULL DEFAULT 0, reply_last_error TEXT, reply_context_revision INTEGER,
  UNIQUE(task_run_id, conversation_id)
);

CREATE TABLE personal_requests (
  request_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  input_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  objective TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  executor_agent_id TEXT NOT NULL,
  account_id TEXT,
  parameters_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('preflighting','waiting_connection','queued','running','completed','failed','cancelled')),
  connection_wait_id TEXT UNIQUE,
  task_id TEXT UNIQUE REFERENCES tasks(task_id) ON DELETE SET NULL,
  result_json TEXT,
  result_run_id TEXT,
  delivery_entry_id TEXT,
  notified_at INTEGER,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_next_attempt_at INTEGER NOT NULL DEFAULT 0,
  delivery_error TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id, transcript_id, idempotency_key)
);

CREATE TABLE personal_attention_threads (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  subject TEXT NOT NULL, summary TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('outcome','discussion','interest')),
  status TEXT NOT NULL CHECK(status IN ('candidate','active','paused','completed','expired')),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit','inferred')),
  task_id TEXT, project_id TEXT, next_check_at INTEGER, pause_until INTEGER, expires_at INTEGER NOT NULL,
  last_meaningful_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE personal_attention_sources (
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES transcript_entries(entry_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
  PRIMARY KEY(thread_id, entry_id)
);

CREATE TABLE personal_wakeups (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE, trigger_kind TEXT NOT NULL, source_event_id TEXT,
  thread_revision INTEGER NOT NULL, not_before INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','evaluating','done','cancelled','dead_letter')),
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE personal_outreach (
  id TEXT PRIMARY KEY, wakeup_id TEXT NOT NULL UNIQUE REFERENCES personal_wakeups(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  origin_transcript_id TEXT NOT NULL, thread_revision INTEGER NOT NULL, context_revision INTEGER NOT NULL,
  policy_revision INTEGER NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('decided','ready','published','stale','cancelled')),
  text TEXT, provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  valid_until INTEGER NOT NULL, message_entry_id TEXT, notified_at INTEGER,
  created_at INTEGER NOT NULL, published_at INTEGER
);

CREATE TABLE personal_feedback (
  id TEXT PRIMARY KEY, outreach_id TEXT NOT NULL REFERENCES personal_outreach(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, kind TEXT NOT NULL, scope TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL, UNIQUE(owner_id, dedupe_key)
);

CREATE TABLE personal_adaptive_strategies (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  feedback_id TEXT NOT NULL UNIQUE REFERENCES personal_feedback(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK(dimension = 'preparation'), value TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority = 'explicit'), revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL, review_at INTEGER NOT NULL
);

CREATE TABLE personal_strategy_versions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES personal_attention_threads(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('stop', 'defer', 'adjust', 'rollback')),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  source_entry_id TEXT REFERENCES transcript_entries(entry_id) ON DELETE SET NULL,
  feedback_id TEXT REFERENCES personal_feedback(id) ON DELETE SET NULL,
  restored_version_id TEXT REFERENCES personal_strategy_versions(id),
  dedupe_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(owner_id, dedupe_key),
  UNIQUE(thread_id, revision)
);

CREATE TABLE browser_automation_versions (
  automation_id TEXT NOT NULL REFERENCES browser_automations(automation_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (automation_id, revision)
);

CREATE TABLE browser_automation_verifications (
  automation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  run_id TEXT NOT NULL REFERENCES browser_automation_runs(run_id) ON DELETE CASCADE,
  verified_at_ms INTEGER NOT NULL,
  PRIMARY KEY (automation_id, revision),
  FOREIGN KEY (automation_id, revision) REFERENCES browser_automation_versions(automation_id, revision) ON DELETE CASCADE
);

CREATE TABLE browser_recordings (
  recording_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  state TEXT NOT NULL,
  ack_seq INTEGER NOT NULL DEFAULT 0,
  final_seq INTEGER,
  automation_id TEXT REFERENCES browser_automations(automation_id) ON DELETE CASCADE,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE browser_recording_events (
  recording_id TEXT NOT NULL REFERENCES browser_recordings(recording_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (recording_id, seq)
);

CREATE TABLE clarification_notification_outbox (
  wait_id TEXT PRIMARY KEY REFERENCES session_clarification_waits(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'settled')),
  created_at INTEGER NOT NULL
);

CREATE TABLE notification_deliveries (
  event_id TEXT NOT NULL REFERENCES notification_events(event_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES device_push_endpoints(device_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'delivered', 'dead', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  provider_ticket_id TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(event_id, device_id)
);

CREATE TABLE endpoint_device_settings (
  principal_id TEXT PRIMARY KEY REFERENCES endpoint_principals(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK(length(nickname) BETWEEN 1 AND 80),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE device_grant_events (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  requestor_principal_id TEXT NOT NULL,
  target_principal_id TEXT NOT NULL,
  target_endpoint_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_sha256 TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('issued','reserved','consumed','revoked','expired')),
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE voice_opening_greetings (
  principal_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  logical_call_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('claimed', 'completed', 'skipped', 'interrupted', 'failed', 'expired')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (principal_id, conversation_id, logical_call_id)
);

CREATE TABLE device_request_nonces (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, nonce)
) WITHOUT ROWID;

CREATE TABLE knowledge_revisions (
  revision_id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE knowledge_evidence_links (
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  content_hash TEXT,
  consent_receipt_id TEXT REFERENCES understanding_consent_receipts(receipt_id),
  PRIMARY KEY (knowledge_id, evidence_id)
);

CREATE TABLE owner_identity_bindings (
  principal_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (channel, account_id, peer_id)
);

CREATE TABLE memory_learning_jobs (
  job_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL DEFAULT 'local-owner',
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  through_seq INTEGER NOT NULL,
  start_seq INTEGER,
  extractor_version TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','retry_wait','failed','canceled')),
  lease_token TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id, transcript_id, through_seq, extractor_version, policy_hash)
);

CREATE TABLE memory_source_learning_jobs (
  job_id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES knowledge_source_chunks(chunk_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  consent_receipt_id TEXT NOT NULL REFERENCES understanding_consent_receipts(receipt_id),
  policy_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','retry_wait','failed','canceled')),
  lease_token TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(chunk_id, agent_id, consent_receipt_id, policy_hash)
);

CREATE TABLE memory_learning_receipts (
  run_id TEXT PRIMARY KEY REFERENCES task_run_receipts(run_id) ON DELETE CASCADE,
  learned_at INTEGER NOT NULL,
  knowledge_id TEXT
);

CREATE TABLE memory_learning_cursors (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  processed_seq INTEGER NOT NULL DEFAULT 0,
  observed_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, transcript_id)
);

CREATE TABLE knowledge_source_chunks (
  chunk_id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE,
  source_version TEXT NOT NULL,
  consent_receipt_id TEXT REFERENCES understanding_consent_receipts(receipt_id),
  ordinal INTEGER NOT NULL,
  locator TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(source_item_id, ordinal)
);

CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(search_text, chunk_id UNINDEXED, tokenize='unicode61');

CREATE VIRTUAL TABLE knowledge_search_fts USING fts5(search_text, knowledge_id UNINDEXED, tokenize='unicode61');

CREATE TABLE agent_selection_records (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT,
  input_id TEXT,
  personal_request_id TEXT REFERENCES personal_requests(request_id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE CASCADE,
  task_run_id TEXT REFERENCES task_runs(run_id) ON DELETE SET NULL,
  decision_group_id TEXT NOT NULL,
  previous_selection_id TEXT REFERENCES agent_selection_records(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  selected_agent_id TEXT NOT NULL,
  selected_agent_revision INTEGER,
  matcher_version INTEGER NOT NULL,
  catalog_revision INTEGER NOT NULL,
  requirements_json TEXT NOT NULL,
  selected_profile_json TEXT,
  assessment_json TEXT NOT NULL,
  candidates_json TEXT,
  selection_source TEXT NOT NULL CHECK(selection_source IN ('snapshot','match','explicit')),
  reason_source TEXT NOT NULL CHECK(reason_source IN ('model','system')),
  selection_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_connection','rejected','task_linked','start_blocked','start_failed')),
  reason_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id, idempotency_key)
);

CREATE TABLE next_turn_suggestions (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale IN ('zh', 'en')),
  suggestion_id TEXT NOT NULL UNIQUE,
  snapshot_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ready', 'none')),
  payload_json TEXT,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, locale)
);

CREATE TABLE next_turn_suggestion_feedback (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  suggestion_id TEXT NOT NULL,
  impression_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('shown', 'accepted', 'dismissed', 'submitted')),
  edited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, impression_id, event)
);

CREATE TABLE task_allocations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id) ON DELETE CASCADE,
  origin_conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  requirements_json TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','selecting','assigned','blocked','failed','cancelled')),
  selected_agent_id TEXT,
  selection_reason TEXT,
  reason_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at INTEGER,
  next_attempt_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE research_checkpoints (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  workspace TEXT NOT NULL,
  goal TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json)),
  status TEXT NOT NULL CHECK(status IN ('running','partial','completed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  summary TEXT NOT NULL DEFAULT '',
  lease_token TEXT,
  lease_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE personal_result_documents (
  document_id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES task_result_deliveries(delivery_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'ready', 'unsupported', 'failed')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  parser_version INTEGER NOT NULL,
  content_revision TEXT,
  content TEXT,
  sections_json TEXT NOT NULL DEFAULT '[]',
  limitations_json TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT,
  error TEXT,
  UNIQUE(delivery_id, source_id)
);

CREATE VIRTUAL TABLE personal_result_search USING fts5(
  document_id UNINDEXED, start_offset UNINDEXED, text, tokenize='trigram'
);

CREATE TABLE personal_result_sections (
  document_id TEXT NOT NULL REFERENCES personal_result_documents(document_id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  char_length INTEGER NOT NULL,
  locator_json TEXT NOT NULL,
  PRIMARY KEY(document_id, section_id)
);

CREATE TABLE personal_result_read_waits (
  input_id TEXT PRIMARY KEY REFERENCES session_inputs(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  requests_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','queued','done','stale'))
);

CREATE TABLE task_work_revisions (
  revision_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  contract_version INTEGER NOT NULL,
  baseline_delivery_id TEXT NOT NULL,
  baseline_version TEXT NOT NULL,
  instruction_entry_id TEXT NOT NULL,
  input_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  supersedes_json TEXT NOT NULL DEFAULT '[]',
  original_body TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id, contract_version)
);

CREATE TABLE discussion_processing (
  discussion_id TEXT PRIMARY KEY REFERENCES discussion_captures(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE,
  audio_sha256 TEXT,
  base_transcript_revision INTEGER NOT NULL,
  force_audio INTEGER NOT NULL DEFAULT 0 CHECK(force_audio IN (0,1)),
  retry_stage TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_owner TEXT,
  lease_until INTEGER
);

CREATE TABLE discussion_transcription_checkpoints (
  run_id TEXT NOT NULL REFERENCES discussion_processing(run_id) ON DELETE CASCADE,
  started_at_ms REAL NOT NULL,
  ended_at_ms REAL NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, started_at_ms, ended_at_ms)
);

CREATE TABLE discussion_annotations (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('highlight','question','note')),
  text TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(discussion_id,id)
);

CREATE TABLE discussion_media_timeline (
  discussion_id TEXT PRIMARY KEY REFERENCES discussion_captures(id) ON DELETE CASCADE,
  audio_sha256 TEXT NOT NULL,
  timeline_json TEXT NOT NULL
);

CREATE TABLE discussion_chapter_progress (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  source_sha256 TEXT NOT NULL,
  transcript_revision INTEGER NOT NULL,
  transcript_sha256 TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  position INTEGER NOT NULL,
  chapter_json TEXT NOT NULL,
  PRIMARY KEY(discussion_id, source_sha256, transcript_revision, transcript_sha256, input_hash)
);

CREATE TABLE "task_main_update_deliveries" (
  entry_id TEXT PRIMARY KEY REFERENCES task_collaboration_entries(entry_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  updated_at INTEGER NOT NULL,
  decision TEXT CHECK (decision IN ('notify', 'silent')),
  decision_reason TEXT,
  decided_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE composer_input_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE task_phase_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  from_phase TEXT NOT NULL,
  to_phase TEXT NOT NULL,
  from_resolution TEXT,
  to_resolution TEXT,
  actor_json TEXT NOT NULL,
  source TEXT NOT NULL,
  operation_id TEXT,
  run_id TEXT,
  task_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id, task_version)
);

CREATE INDEX idx_transcripts_session
  ON transcripts("conversation_id", status);

CREATE INDEX idx_entries_session_seq
  ON transcript_entries("transcript_id", seq);

CREATE INDEX idx_entries_kind
  ON transcript_entries("transcript_id", entry_kind);

CREATE INDEX idx_automation_runs_automation_created
  ON automation_runs(automation_id, created_at_ms DESC);

CREATE INDEX idx_automation_runs_created
  ON automation_runs(created_at_ms DESC);

CREATE INDEX idx_automation_runs_status_created
  ON automation_runs(status, created_at_ms DESC);

CREATE INDEX idx_automation_run_events_run_created
  ON automation_run_events(run_id, created_at_ms ASC);

CREATE INDEX idx_automation_run_events_automation_created
  ON automation_run_events(automation_id, created_at_ms DESC);

CREATE INDEX idx_home_attention_acknowledged_at
  ON home_attention_acknowledgements(acknowledged_at DESC);

CREATE INDEX idx_notes_status_updated
  ON notes(status, updated_at DESC);

CREATE INDEX idx_notes_kind
  ON notes(kind);

CREATE INDEX idx_notes_group
  ON notes(group_id);

CREATE INDEX idx_note_agent_contexts_generated
  ON note_agent_contexts(generated_at DESC);

CREATE INDEX idx_activity_events_created
  ON activity_events(created_at DESC);

CREATE INDEX idx_activity_events_object_created
  ON activity_events(primary_object_kind, primary_object_id, created_at DESC);

CREATE INDEX idx_activity_scopes_scope
  ON activity_scopes(scope_kind, scope_id, activity_id);

CREATE INDEX idx_object_links_from
  ON object_links(from_kind, from_id);

CREATE INDEX idx_object_links_to
  ON object_links(to_kind, to_id);

CREATE INDEX idx_activity_related_projects_project
  ON activity_related_projects(project_id, activity_id);

CREATE INDEX idx_browser_automation_runs_automation_created
  ON browser_automation_runs(automation_id, created_at_ms DESC);

CREATE INDEX idx_browser_action_audit_run_seq
  ON browser_action_audit(run_id, seq ASC);

CREATE INDEX idx_projects_status
  ON projects(status, updated_at DESC);

CREATE INDEX idx_projects_slug
  ON projects(slug);

CREATE INDEX idx_projects_updated
  ON projects(updated_at DESC);

CREATE INDEX idx_projects_pinned
  ON projects(pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

CREATE INDEX idx_knowledge_sync_runs_source_started
  ON knowledge_sync_runs(source_instance_id, started_at DESC);

CREATE INDEX idx_knowledge_sync_runs_status_started
  ON knowledge_sync_runs(status, started_at DESC);

CREATE INDEX idx_local_apps_updated_at ON local_apps(updated_at DESC);

CREATE INDEX idx_local_apps_status ON local_apps(status, updated_at DESC);

CREATE INDEX idx_local_app_releases_app ON local_app_releases(app_id, version DESC);

CREATE INDEX idx_local_app_releases_created
  ON local_app_releases(app_id, created_at DESC);

CREATE INDEX idx_local_app_acceptance_runs_app_created
  ON local_app_acceptance_runs(app_id, created_at DESC);

CREATE INDEX idx_local_app_acceptance_runs_source
  ON local_app_acceptance_runs(app_id, source_hash, created_at DESC);

CREATE INDEX idx_work_discovery_runs_status_created
  ON work_discovery_runs(status, created_at DESC);

CREATE INDEX idx_work_discovery_runs_project
  ON work_discovery_runs(project_id, created_at DESC);

CREATE INDEX idx_extension_ui_grants_app_granted
  ON extension_ui_grants(app_id, granted_at DESC);

CREATE INDEX idx_work_discovery_feedback_updated
  ON work_discovery_feedback(updated_at DESC);

CREATE INDEX idx_connector_learning_jobs_due
  ON connector_learning_jobs(status, next_run_at, created_at);

CREATE INDEX idx_connector_learning_jobs_source
  ON connector_learning_jobs(source_instance_id, created_at DESC);

CREATE INDEX idx_knowledge_source_items_source_updated
  ON knowledge_source_items(source_instance_id, updated_at DESC);

CREATE INDEX idx_knowledge_source_items_synthesis
  ON knowledge_source_items(synthesis_status, updated_at);

CREATE INDEX idx_knowledge_source_items_hash
  ON knowledge_source_items(content_hash);

CREATE INDEX idx_knowledge_source_items_synthesis_lease
  ON knowledge_source_items(synthesis_pipeline, synthesis_status, synthesis_claimed_at, updated_at);

CREATE INDEX idx_knowledge_source_items_collection
  ON knowledge_source_items(source_instance_id, collection_scope, updated_at DESC);

CREATE INDEX idx_knowledge_source_changes_source_sequence
  ON knowledge_source_changes(source_instance_id, sequence);

CREATE INDEX idx_knowledge_source_changes_changed_at
  ON knowledge_source_changes(changed_at DESC);

CREATE INDEX idx_automation_runs_lease
  ON automation_runs(status, lease_expires_at_ms);

CREATE INDEX idx_discussion_captures_queue
  ON discussion_captures(status, work_lease_expires_at, updated_at);

CREATE INDEX idx_discussion_captures_project
  ON discussion_captures(project_id, updated_at DESC);

CREATE INDEX idx_discussion_segments_queue
  ON discussion_transcript_segments(status, next_attempt_at, created_at);

CREATE INDEX idx_discussion_organizations_latest
  ON discussion_organizations(discussion_id, revision DESC);

CREATE INDEX idx_project_milestones_project_sort
  ON project_milestones(project_id, sort_order, created_at);

CREATE INDEX idx_project_updates_project_created
  ON project_updates(project_id, created_at DESC);

CREATE UNIQUE INDEX idx_tasks_creation_idempotency
  ON tasks(creation_idempotency_key) WHERE creation_idempotency_key IS NOT NULL;

CREATE INDEX idx_tasks_project_updated ON tasks(project_id, updated_at DESC);

CREATE INDEX idx_tasks_phase_updated ON tasks(phase, updated_at DESC);

CREATE INDEX idx_tasks_parent ON tasks(parent_task_id, updated_at DESC);

CREATE INDEX idx_task_dependencies_upstream
  ON task_dependencies(depends_on_task_id, task_id);

CREATE UNIQUE INDEX idx_task_sessions_identity
  ON task_sessions(task_id, "conversation_id", role) WHERE "conversation_id" IS NOT NULL;

CREATE INDEX idx_task_sessions_session ON task_sessions("conversation_id", created_at DESC);

CREATE INDEX idx_task_waits_task_status ON task_waits(task_id, status, created_at DESC);

CREATE INDEX idx_task_waits_resume ON task_waits(status, resume_at);

CREATE INDEX idx_task_authority_grants_task
  ON task_authority_grants(task_id, revoked_at, expires_at);

CREATE INDEX idx_context_edges_owner
  ON context_edges(owner_kind, owner_id, role, created_at);

CREATE INDEX idx_context_edges_target
  ON context_edges(target_kind, target_id, created_at);

CREATE INDEX idx_task_runs_task_queued ON task_runs(task_id, queued_at DESC);

CREATE INDEX idx_task_runs_dispatch ON task_runs(status, scheduled_at, queued_at);

CREATE INDEX idx_task_runs_lease ON task_runs(lease_expires_at);

CREATE INDEX idx_task_runs_root ON task_runs(root_run_id, queued_at);

CREATE UNIQUE INDEX idx_task_runs_active_root
  ON task_runs(task_id)
  WHERE parent_run_id IS NULL
    AND status IN ('queued', 'running', 'waiting', 'verifying');

CREATE UNIQUE INDEX idx_task_runs_root_attempt
  ON task_runs(task_id, attempt) WHERE parent_run_id IS NULL;

CREATE INDEX idx_task_run_events_run_sequence ON task_run_events(run_id, sequence);

CREATE INDEX idx_domain_outbox_pending ON domain_outbox(published_at, created_at);

CREATE INDEX idx_connector_learning_jobs_account
  ON connector_learning_jobs(account_id, created_at DESC);

CREATE INDEX idx_endpoint_tool_invocations_endpoint_started
  ON endpoint_tool_invocations(endpoint_id, started_at DESC);

CREATE UNIQUE INDEX idx_context_evidence_source
  ON context_evidence(principal_id, source_type, COALESCE(source_instance_id, ''), source_ref);

CREATE INDEX idx_understanding_source_grants_status
  ON understanding_source_grants(status, category, updated_at DESC);

CREATE INDEX idx_understanding_source_runs_grant
  ON understanding_source_runs(grant_id, started_at DESC);

CREATE INDEX idx_understanding_source_runs_status
  ON understanding_source_runs(status, started_at ASC);

CREATE INDEX idx_work_understanding_evidence_investigation
  ON work_understanding_evidence(investigation_id, collected_at ASC);

CREATE INDEX idx_work_understanding_evidence_source
  ON work_understanding_evidence(source_grant_id, source_type, collected_at DESC);

CREATE INDEX idx_tasks_project_phase_rank
  ON tasks(project_id, phase, board_rank, created_at);

CREATE UNIQUE INDEX idx_task_sessions_active_execution
  ON task_sessions(task_id)
  WHERE role = 'execution' AND status = 'active';

CREATE UNIQUE INDEX idx_task_sessions_execution_owner
  ON task_sessions("conversation_id")
  WHERE role = 'execution' AND "conversation_id" IS NOT NULL;

CREATE INDEX idx_task_handoffs_task
  ON task_handoff_snapshots(task_id, assignment_epoch DESC);

CREATE INDEX idx_automation_runs_unread_created
  ON automation_runs(read_at_ms, created_at_ms DESC);

CREATE INDEX idx_context_extraction_runs_lookup
  ON context_extraction_runs(extractor_id, status, started_at DESC);

CREATE INDEX idx_context_evidence_run
  ON context_evidence(source_run_id, observed_at DESC);

CREATE INDEX idx_context_evidence_message
  ON context_evidence(conversation_id, turn_id, message_id);

CREATE INDEX idx_user_people_principal_kind
  ON user_people(principal_id, inferred_kind, last_observed_at DESC);

CREATE INDEX idx_user_people_merge_target
  ON user_people(merged_into_person_id);

CREATE INDEX idx_user_person_handles_person ON user_person_handles(person_id);

CREATE INDEX idx_user_person_handles_lookup ON user_person_handles(handle_type, normalized_value);

CREATE INDEX idx_user_person_source_stats_source
  ON user_person_source_stats(source_instance_id, last_observed_at DESC);

CREATE INDEX idx_notification_events_created
  ON notification_events(created_at, event_id);

CREATE UNIQUE INDEX idx_execution_environments_active_root
  ON execution_environments(root_path)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_execution_environments_project
  ON execution_environments(project_id, updated_at DESC);

CREATE UNIQUE INDEX idx_execution_environment_bindings_active_session
  ON execution_environment_bindings("conversation_id")
  WHERE released_at IS NULL;

CREATE INDEX idx_execution_environment_bindings_environment
  ON execution_environment_bindings(environment_id, created_at DESC);

CREATE INDEX idx_execution_environment_events_environment
  ON execution_environment_events(environment_id, created_at DESC);

CREATE INDEX idx_projects_execution_mode
  ON projects(execution_mode, updated_at DESC);

CREATE INDEX durable_messages_pending ON durable_messages(queue, scope, processed_at, sequence);

CREATE UNIQUE INDEX durable_share_token ON durable_state(namespace, json_extract(payload, '$.token'))
  WHERE namespace IN ('shares', 'site-shares');

CREATE UNIQUE INDEX durable_site_subdomain ON durable_state(json_extract(payload, '$.subdomain'))
  WHERE namespace = 'site-shares' AND json_extract(payload, '$.subdomain') IS NOT NULL;

CREATE UNIQUE INDEX idx_user_assertion_slots_identity
  ON user_assertion_slots(
    principal_id, subject_type, subject_id, predicate, scope_type, COALESCE(scope_id, '')
  );

CREATE INDEX idx_user_assertion_slots_subject
  ON user_assertion_slots(principal_id, subject_type, subject_id, predicate);

CREATE INDEX idx_user_assertion_slots_scope
  ON user_assertion_slots(principal_id, scope_type, scope_id);

CREATE INDEX idx_user_assertions_slot_status
  ON user_assertions(slot_id, status, valid_from, valid_to);

CREATE INDEX idx_user_assertions_review
  ON user_assertions(status, review_at) WHERE review_at IS NOT NULL;

CREATE INDEX idx_user_assertions_recorded
  ON user_assertions(recorded_at DESC);

CREATE INDEX idx_user_assertion_evidence_source
  ON user_assertion_evidence(evidence_id, relation);

CREATE INDEX idx_user_assertion_status_events_assertion
  ON user_assertion_status_events(assertion_id, created_at DESC);

CREATE INDEX idx_user_goals_status
  ON user_goals(principal_id, status, updated_at DESC);

CREATE INDEX idx_user_goals_scope
  ON user_goals(principal_id, scope_type, scope_id, status);

CREATE INDEX idx_user_priority_windows_active
  ON user_priority_windows(principal_id, status, valid_from, valid_to);

CREATE INDEX idx_user_priority_windows_target
  ON user_priority_windows(target_type, target_id, status);

CREATE INDEX idx_memory_maintenance_runs_principal
  ON memory_maintenance_runs(principal_id, started_at DESC);

CREATE INDEX idx_memory_maintenance_decisions_run
  ON memory_maintenance_decisions(run_id, created_at);

CREATE UNIQUE INDEX idx_connection_wait_active ON session_connection_waits(principal_id,"transcript_id")
  WHERE status IN ('open','queued');

CREATE INDEX idx_connection_wait_session ON session_connection_waits("conversation_id");

CREATE UNIQUE INDEX idx_clarification_wait_active
  ON session_clarification_waits(principal_id, "transcript_id")
  WHERE status IN ('open', 'queued');

CREATE INDEX idx_clarification_wait_session
  ON session_clarification_waits("conversation_id", "transcript_id", status);

CREATE INDEX idx_session_inputs_pending
  ON session_inputs("conversation_id",status,position,created_at_ms);

CREATE INDEX idx_device_refresh_credentials_device
  ON device_refresh_credentials(device_id, expires_at);

CREATE INDEX idx_device_access_sessions_device
  ON device_access_sessions(device_id, expires_at);

CREATE INDEX idx_browser_tab_bindings_expiry ON browser_tab_bindings(expires_at);

CREATE INDEX idx_endpoint_principals_active
  ON endpoint_principals(kind, last_seen_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_endpoint_instance_bindings_principal
  ON endpoint_instance_bindings(principal_id);

CREATE INDEX idx_endpoint_session_bindings_endpoint
  ON endpoint_session_bindings(endpoint_id);

CREATE INDEX idx_browser_sessions_expiry ON browser_sessions(expires_at);

CREATE INDEX idx_device_pairing_sessions_expiry
  ON device_pairing_sessions(expires_at);

CREATE INDEX idx_device_pairing_requests_expiry
  ON device_pairing_requests(recovery_until);

CREATE INDEX discussion_recording_jobs_pending ON discussion_recording_jobs(state, created_at);

CREATE INDEX capability_imports_owner_kind ON capability_imports(owner, kind, created_at DESC);

CREATE UNIQUE INDEX capability_imports_idempotency ON capability_imports(owner, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX import_selections_owner_kind ON import_selections(owner, kind, created_at DESC);

CREATE INDEX knowledge_sync_source_scope ON knowledge_sync_runs(source_instance_id, collection_scope, started_at DESC);

CREATE INDEX idx_connector_authorization_attempt_scope ON connector_authorization_attempts(principal_id,connector_id,created_at);

CREATE INDEX idx_understanding_refresh_batches_created ON understanding_refresh_batches(created_at DESC);

CREATE INDEX idx_sidebar_positions_order
  ON sidebar_positions(container_id, position);

CREATE UNIQUE INDEX idx_cli_active_authorization ON connector_cli_authorizations(instance_id, principal_id)
  WHERE phase IN ('preparing','awaiting_user','verifying');

CREATE INDEX capability_invocations_operation ON capability_invocations(operation_id, created_at);

CREATE INDEX idx_knowledge_items_status
  ON knowledge_items(principal_id, status, updated_at DESC);

CREATE INDEX idx_knowledge_items_scope
  ON knowledge_items(principal_id, scope_type, scope_id, status);

CREATE INDEX idx_knowledge_items_lifecycle
  ON knowledge_items(status, expires_at, review_at);

CREATE INDEX idx_knowledge_items_class_status
  ON knowledge_items(principal_id, record_class, status, updated_at DESC);

CREATE UNIQUE INDEX idx_knowledge_items_canonical
  ON knowledge_items(principal_id, canonical_key, scope_type, COALESCE(scope_id, ''))
  WHERE status IN ('candidate', 'active', 'needs_review', 'stale');

CREATE INDEX idx_knowledge_item_status_events_item
  ON knowledge_item_status_events(knowledge_id, created_at DESC);

CREATE UNIQUE INDEX idx_understanding_source_runs_connector_job
  ON understanding_source_runs(connector_learning_job_id)
  WHERE connector_learning_job_id IS NOT NULL;

CREATE INDEX idx_context_extraction_outputs_object
  ON context_extraction_outputs(object_type, object_id);

CREATE INDEX idx_chat_previews_conversation_updated
  ON chat_previews(conversation_id, updated_at DESC);

CREATE INDEX idx_chat_preview_revisions_created
  ON chat_preview_revisions(preview_id, created_at DESC);

CREATE INDEX idx_context_snapshots_owner
  ON context_snapshots(owner_kind, owner_id, created_at DESC);

CREATE INDEX idx_context_snapshots_session
  ON context_snapshots(conversation_id, created_at DESC);

CREATE INDEX idx_collaboration_rules_principal_status
  ON collaboration_rules(principal_id, status, priority, updated_at DESC);

CREATE UNIQUE INDEX idx_home_advice_generation_idempotency
  ON home_advice_generations(owner_id, workspace_id, idempotency_key);

CREATE UNIQUE INDEX idx_home_advice_generation_active
  ON home_advice_generations(owner_id, workspace_id)
  WHERE status IN ('queued', 'running', 'retry_wait');

CREATE INDEX idx_home_advice_generation_claim
  ON home_advice_generations(status, retry_at, requested_at);

CREATE INDEX idx_home_advice_generation_latest
  ON home_advice_generations(owner_id, workspace_id, completed_at DESC);

CREATE UNIQUE INDEX idx_home_opportunity_active_dedupe
  ON home_opportunity_projections(owner_id, workspace_id, dedupe_key)
  WHERE state IN ('active', 'snoozed');

CREATE INDEX idx_home_opportunity_visible
  ON home_opportunity_projections(owner_id, workspace_id, state, rank, expires_at);

CREATE INDEX idx_home_opportunity_feedback_item
  ON home_opportunity_feedback(opportunity_id, created_at DESC);

CREATE INDEX idx_agents_available ON agents(enabled, provisioning_state, deleted_at, id);

CREATE INDEX idx_agent_bindings_agent ON agent_bindings(agent_id, position);

CREATE INDEX idx_understanding_consent_receipts_grant
  ON understanding_consent_receipts(grant_id, granted_at DESC);

CREATE UNIQUE INDEX idx_understanding_consent_receipts_active
  ON understanding_consent_receipts(grant_id) WHERE revoked_at IS NULL;

CREATE INDEX idx_user_model_observations_domain_time
  ON user_model_observations(principal_id, domain, observed_at DESC);

CREATE INDEX idx_user_model_observations_expiry
  ON user_model_observations(delete_after) WHERE delete_after IS NOT NULL;

CREATE INDEX idx_user_model_observations_source
  ON user_model_observations(source_grant_id, source_item_id);

CREATE INDEX idx_user_assertion_edges_to
  ON user_assertion_edges(to_assertion_id, relation);

CREATE UNIQUE INDEX idx_automation_event_deliveries_run
  ON automation_event_deliveries(run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX idx_automation_event_deliveries_pending
  ON automation_event_deliveries(status, next_attempt_at_ms, created_at_ms);

CREATE INDEX idx_task_runs_contract
  ON task_runs(task_id, contract_version);

CREATE INDEX idx_task_runs_conversation
  ON task_runs(conversation_id);

CREATE INDEX idx_task_runs_parent
  ON task_runs(parent_run_id);

CREATE INDEX idx_task_runs_retry
  ON task_runs(retry_of_run_id);

CREATE INDEX idx_task_runs_context_snapshot
  ON task_runs(context_snapshot_id);

CREATE INDEX idx_task_run_feedback_run
  ON task_run_feedback(run_id);

CREATE INDEX idx_work_discovery_runs_conversation
  ON work_discovery_runs(conversation_id);

CREATE INDEX idx_connector_learning_jobs_connection
  ON connector_learning_jobs(connection_id);

CREATE INDEX idx_knowledge_source_changes_item
  ON knowledge_source_changes(source_item_id);

CREATE INDEX idx_automations_enabled ON automations(enabled, updated_at_ms DESC);

CREATE INDEX idx_automations_updated ON automations(updated_at_ms DESC);

CREATE INDEX idx_automations_project ON automations(project_id, updated_at_ms DESC);

CREATE UNIQUE INDEX idx_automation_events_source_dedupe
  ON automation_events(source, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE INDEX idx_automation_events_projection
  ON automation_events(projection_status, projection_next_attempt_at_ms, ingested_at_ms);

CREATE INDEX idx_automation_result_deliveries_pending
  ON automation_result_deliveries(status, next_attempt_at_ms, created_at_ms);

CREATE INDEX idx_ai_usage_events_started ON ai_usage_events(started_at DESC, id DESC);

CREATE INDEX idx_ai_usage_events_conversation ON ai_usage_events(conversation_id, started_at DESC);

CREATE INDEX idx_ai_usage_events_trace ON ai_usage_events(trace_id, started_at ASC);

CREATE INDEX idx_ai_usage_events_agent ON ai_usage_events(agent_id, started_at DESC);

CREATE INDEX idx_ai_usage_events_category ON ai_usage_events(category, started_at DESC);

CREATE INDEX idx_sessions_agent_updated ON sessions(agent_id, updated_at DESC);

CREATE INDEX idx_sessions_last_interaction ON sessions(last_interaction_at DESC);

CREATE INDEX idx_sessions_parent ON sessions(parent_conversation_id);

CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at DESC);

CREATE INDEX idx_sessions_source_channel ON sessions(source_channel);

CREATE INDEX idx_sessions_status ON sessions(status);

CREATE INDEX idx_sessions_type ON sessions(session_type);

CREATE INDEX idx_connector_catalog_provider ON connector_catalog_entries(provider, fetched_at DESC);

CREATE INDEX idx_connector_installations_principal
  ON connector_installations(principal_id, enabled, connector_id);

CREATE UNIQUE INDEX idx_cli_account_identity
  ON connector_accounts(principal_id, runtime_instance_id, identity_key)
  WHERE runtime_instance_id IS NOT NULL AND identity_key IS NOT NULL;

CREATE UNIQUE INDEX idx_connector_accounts_identity
  ON connector_accounts(principal_id, backend_id, connector_id, identity_key)
  WHERE identity_key IS NOT NULL;

CREATE INDEX idx_connector_connections_account ON connector_connections(account_id);

CREATE INDEX idx_connector_connections_principal
  ON connector_connections(principal_id, connector_id, status);

CREATE UNIQUE INDEX idx_connector_connections_provider_backend
  ON connector_connections(provider, COALESCE(json_extract(metadata_json, '$.backendId'), ''), provider_connection_id);

CREATE INDEX idx_connector_action_scope
  ON connector_action_metadata(connector_id, scope, curated);

CREATE INDEX idx_connector_audit_connector_time
  ON connector_execution_audit(connector_id, created_at DESC);

CREATE INDEX idx_connector_audit_principal_time
  ON connector_execution_audit(principal_id, created_at DESC);

CREATE INDEX idx_connector_execution_audit_connection
  ON connector_execution_audit(connection_id);

CREATE INDEX idx_connector_execution_audit_installation
  ON connector_execution_audit(installation_id);

CREATE INDEX idx_connector_approvals_connection ON connector_approvals(connection_id);

CREATE INDEX idx_connector_approvals_pending
  ON connector_approvals(principal_id, status, expires_at, created_at DESC);

CREATE INDEX idx_connector_approvals_session
  ON connector_approvals(conversation_id, status, created_at DESC);

CREATE INDEX idx_connector_webhook_deliveries_status
  ON connector_webhook_deliveries(provider, status, received_at DESC);

CREATE UNIQUE INDEX idx_connector_backend_active
  ON connector_backends(active) WHERE active = 1;

CREATE INDEX idx_ai_usage_events_provider_model
  ON ai_usage_events(provider, model, started_at DESC);

CREATE INDEX idx_task_origin_links_conversation
  ON task_origin_links(conversation_id, created_at DESC);

CREATE INDEX idx_task_collaboration_task_sequence
  ON task_collaboration_entries(task_id, sequence);

CREATE INDEX idx_task_collaboration_deliveries_pending
  ON task_collaboration_deliveries(status, updated_at);

CREATE INDEX idx_task_main_agent_links_agent_created
  ON task_main_agent_links(agent_id, created_at DESC);

CREATE INDEX idx_task_result_deliveries_pending
  ON task_result_deliveries(status, next_attempt_at);

CREATE INDEX idx_personal_requests_conversation ON personal_requests(conversation_id, created_at);

CREATE INDEX idx_ai_usage_events_otel_trace ON ai_usage_events(otel_trace_id) WHERE otel_trace_id IS NOT NULL;

CREATE INDEX idx_task_result_reply_pending ON task_result_deliveries(reply_status, reply_next_attempt_at, reply_lease_until);

CREATE INDEX personal_attention_due ON personal_attention_threads(status, next_check_at);

CREATE INDEX personal_wakeups_due ON personal_wakeups(status, next_attempt_at, not_before);

CREATE INDEX personal_outreach_pending ON personal_outreach(state, created_at);

CREATE INDEX personal_strategy_versions_thread ON personal_strategy_versions(thread_id, revision DESC);

CREATE UNIQUE INDEX idx_browser_run_request ON browser_automation_runs(client_request_id) WHERE client_request_id IS NOT NULL;

CREATE INDEX idx_clarification_notification_pending ON clarification_notification_outbox(status, created_at);

CREATE INDEX idx_notification_deliveries_due ON notification_deliveries(status, next_attempt_at);

CREATE INDEX idx_notification_deliveries_device ON notification_deliveries(device_id);

CREATE INDEX device_grant_events_conversation ON device_grant_events(conversation_id, created_at_ms);

CREATE UNIQUE INDEX idx_ai_usage_cloud_request
  ON ai_usage_events(cloud_request_id) WHERE cloud_request_id IS NOT NULL;

CREATE INDEX idx_voice_opening_greetings_created ON voice_opening_greetings(created_at);

CREATE INDEX device_request_nonces_expiry ON device_request_nonces(expires_at);

CREATE INDEX knowledge_revisions_item ON knowledge_revisions(knowledge_id, created_at);

CREATE INDEX memory_learning_jobs_due ON memory_learning_jobs(state, next_attempt_at, lease_until);

CREATE INDEX memory_source_learning_due ON memory_source_learning_jobs(state, next_attempt_at, lease_until);

CREATE INDEX agent_selection_task ON agent_selection_records(task_id, created_at);

CREATE INDEX agent_selection_request ON agent_selection_records(personal_request_id);

CREATE INDEX agent_selection_origin ON agent_selection_records(conversation_id, created_at);

CREATE INDEX idx_next_turn_feedback_created ON next_turn_suggestion_feedback(created_at);

CREATE INDEX task_allocations_pending ON task_allocations(status, next_attempt_at, lease_expires_at);

CREATE INDEX research_checkpoints_conversation ON research_checkpoints(conversation_id, updated_at);

CREATE INDEX idx_personal_result_sections_order ON personal_result_sections(document_id, ordinal);

CREATE INDEX idx_task_main_update_deliveries_pending
  ON task_main_update_deliveries(status, updated_at);

CREATE INDEX idx_composer_input_history_recent
  ON composer_input_history(conversation_id, id DESC);

CREATE INDEX idx_task_phase_changes_task ON task_phase_changes(task_id, task_version);

CREATE TRIGGER session_creation_tombstone BEFORE DELETE ON sessions BEGIN
  INSERT INTO session_tombstones(conversation_id, deleted_at)
  VALUES (OLD.conversation_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(conversation_id) DO NOTHING;
  INSERT INTO session_preparation_cleanup(environment_id, conversation_id, not_before)
  SELECT environment_id, conversation_id, max(lease_until, CAST(unixepoch('subsec') * 1000 AS INTEGER)) + 5000
  FROM session_preparations WHERE conversation_id=OLD.conversation_id
    AND json_extract(creation_json, '$.execution.mode')='managed_worktree'
  ON CONFLICT(environment_id) DO NOTHING;
END;

CREATE TRIGGER assertion_evidence_snapshot_insert AFTER INSERT ON user_assertion_evidence BEGIN
  UPDATE user_assertion_evidence SET content_hash = (SELECT content_hash FROM context_evidence WHERE evidence_id = NEW.evidence_id)
    WHERE assertion_id = NEW.assertion_id AND evidence_id = NEW.evidence_id AND relation = NEW.relation;
END;

CREATE TRIGGER assertion_evidence_snapshot_update AFTER UPDATE OF confidence ON user_assertion_evidence BEGIN
  UPDATE user_assertion_evidence SET content_hash = (SELECT content_hash FROM context_evidence WHERE evidence_id = NEW.evidence_id)
    WHERE assertion_id = NEW.assertion_id AND evidence_id = NEW.evidence_id AND relation = NEW.relation;
END;

CREATE TRIGGER knowledge_chunk_insert AFTER INSERT ON knowledge_source_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(search_text, chunk_id) VALUES (xopc_memory_search_text(NEW.text), NEW.chunk_id);
END;

CREATE TRIGGER knowledge_chunk_delete AFTER DELETE ON knowledge_source_chunks BEGIN
  DELETE FROM knowledge_chunks_fts WHERE chunk_id = OLD.chunk_id;
END;

CREATE TRIGGER knowledge_search_insert AFTER INSERT ON knowledge_items BEGIN
  INSERT INTO knowledge_search_fts VALUES (xopc_memory_search_text(NEW.content), NEW.knowledge_id);
END;

CREATE TRIGGER knowledge_search_update AFTER UPDATE OF content ON knowledge_items BEGIN
  DELETE FROM knowledge_search_fts WHERE knowledge_id = OLD.knowledge_id;
  INSERT INTO knowledge_search_fts VALUES (xopc_memory_search_text(NEW.content), NEW.knowledge_id);
END;

CREATE TRIGGER knowledge_search_delete AFTER DELETE ON knowledge_items BEGIN
  DELETE FROM knowledge_search_fts WHERE knowledge_id = OLD.knowledge_id;
END;

CREATE TRIGGER personal_result_documents_delete AFTER DELETE ON personal_result_documents BEGIN
  DELETE FROM personal_result_search WHERE document_id = old.document_id;
END;

INSERT INTO work_discovery_onboarding VALUES (1,'not_started',NULL,NULL,NULL,0);
INSERT INTO discussion_capture_settings VALUES ('default',1,NULL,CAST(unixepoch('subsec') * 1000 AS INTEGER));
INSERT INTO connector_runtime_identity VALUES (1,lower(hex(randomblob(16))));
