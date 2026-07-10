-- xopc SQLite schema: sessions, transcripts, automations, notes, memory, FTS

CREATE TABLE IF NOT EXISTS sessions (
  session_key              TEXT PRIMARY KEY,
  agent_id                 TEXT NOT NULL,
  session_id                TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL DEFAULT 'active',
  name                     TEXT,
  tags_json                TEXT NOT NULL DEFAULT '[]',
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  last_accessed_at         INTEGER NOT NULL,
  session_started_at       INTEGER,
  last_interaction_at      INTEGER,
  source_channel           TEXT NOT NULL DEFAULT '',
  source_chat_id           TEXT NOT NULL DEFAULT '',
  session_type             TEXT,
  hidden_from_session_list INTEGER NOT NULL DEFAULT 0,
  parent_session_key       TEXT,
  workflow_run_id          TEXT,
  workflow_definition_id   TEXT,
  workflow_agent_id        TEXT,
  workflow_agent_label     TEXT,
  routing_json             TEXT,
  custom_data_json         TEXT,
  abort_cutoff_timestamp   INTEGER,
  message_count            INTEGER NOT NULL DEFAULT 0,
  estimated_tokens         INTEGER NOT NULL DEFAULT 0,
  compacted_count          INTEGER NOT NULL DEFAULT 0,
  last_flushed_at          TEXT,
  flush_count              INTEGER NOT NULL DEFAULT 0,
  thinking_level           TEXT,
  verbose_level            TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent_updated
  ON sessions(agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_source_channel
  ON sessions(source_channel);
CREATE INDEX IF NOT EXISTS idx_sessions_last_interaction
  ON sessions(last_interaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_type
  ON sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_sessions_workflow_run
  ON sessions(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent
  ON sessions(parent_session_key);

CREATE TABLE IF NOT EXISTS session_config (
  session_key                  TEXT PRIMARY KEY,
  thinking_level               TEXT,
  reasoning_level              TEXT,
  verbose_level                TEXT,
  elevated_mode                TEXT,
  model_override               TEXT,
  provider_override            TEXT,
  working_directory_override   TEXT,
  updated_at                   INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcripts (
  session_id        TEXT PRIMARY KEY,
  session_key        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  archive_reason     TEXT,
  created_at         INTEGER NOT NULL,
  archived_at        INTEGER,
  cwd                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcripts_session
  ON transcripts(session_key, status);

CREATE TABLE IF NOT EXISTS transcript_entries (
  entry_id        TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  entry_kind      TEXT NOT NULL,
  role            TEXT,
  payload_json    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(session_id, seq),
  FOREIGN KEY (session_id) REFERENCES transcripts(session_id)
);

CREATE INDEX IF NOT EXISTS idx_entries_session_seq
  ON transcript_entries(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_entries_kind
  ON transcript_entries(session_id, entry_kind);

CREATE TABLE IF NOT EXISTS compaction_checkpoints (
  checkpoint_id    TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  session_key      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  message_count    INTEGER NOT NULL,
  size_bytes       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoint_entries (
  checkpoint_id   TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  entry_kind      TEXT NOT NULL,
  role            TEXT,
  payload_json    TEXT NOT NULL,
  PRIMARY KEY (checkpoint_id, seq),
  FOREIGN KEY (checkpoint_id) REFERENCES compaction_checkpoints(checkpoint_id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
  content,
  session_key UNINDEXED,
  session_id UNINDEXED,
  entry_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS automations (
  automation_id     TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  enabled           INTEGER NOT NULL,
  trigger_json      TEXT NOT NULL,
  action_json       TEXT NOT NULL,
  after_run_json    TEXT,
  reliability_json  TEXT,
  state_json        TEXT NOT NULL DEFAULT '{}',
  created_at_ms     INTEGER NOT NULL,
  updated_at_ms     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automations_enabled
  ON automations(enabled, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_automations_updated
  ON automations(updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS automation_runs (
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
  session_key            TEXT,
  workflow_run_id        TEXT,
  model                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_automation_created
  ON automation_runs(automation_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_created
  ON automation_runs(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status_created
  ON automation_runs(status, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS automation_run_events (
  event_id       TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  automation_id  TEXT NOT NULL,
  type           TEXT NOT NULL,
  message        TEXT NOT NULL,
  data_json      TEXT,
  created_at_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_run_events_run_created
  ON automation_run_events(run_id, created_at_ms ASC);
CREATE INDEX IF NOT EXISTS idx_automation_run_events_automation_created
  ON automation_run_events(automation_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id              TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL,
  definition_id       TEXT NOT NULL,
  definition_version  TEXT NOT NULL,
  goal_id             TEXT,
  session_key         TEXT NOT NULL,
  parent_session_key  TEXT,
  status              TEXT NOT NULL,
  source_kind         TEXT NOT NULL,
  source_json         TEXT NOT NULL,
  metadata_json       TEXT,
  title               TEXT NOT NULL,
  created_at_ms       INTEGER NOT NULL,
  started_at_ms       INTEGER,
  completed_at_ms     INTEGER,
  metrics_json        TEXT NOT NULL,
  result_preview      TEXT,
  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_goal_created
  ON workflow_runs(goal_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_created
  ON workflow_runs(agent_id, status, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_definition_created
  ON workflow_runs(definition_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_created
  ON workflow_runs(agent_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS notes (
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

CREATE INDEX IF NOT EXISTS idx_notes_status_updated
  ON notes(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_kind
  ON notes(kind);
CREATE INDEX IF NOT EXISTS idx_notes_group
  ON notes(group_id);

CREATE TABLE IF NOT EXISTS note_agent_contexts (
  note_id TEXT PRIMARY KEY,
  note_updated_at INTEGER NOT NULL,
  context_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_agent_contexts_generated
  ON note_agent_contexts(generated_at DESC);

CREATE TABLE IF NOT EXISTS memory_files (
  file_id       TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  path          TEXT NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  UNIQUE(agent_id, path)
);

CREATE TABLE IF NOT EXISTS memory_chunks (
  chunk_id    TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES memory_files(file_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_file
  ON memory_chunks(file_id, start_line);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  content,
  note_id UNINDEXED,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  chunk_id UNINDEXED,
  agent_id UNINDEXED,
  path UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS memory_records (
  record_id       TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL,
  kind            TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  workspace_id    TEXT,
  session_key     TEXT,
  content         TEXT NOT NULL,
  source_json     TEXT NOT NULL,
  confidence      REAL,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_recalled_at INTEGER,
  recall_count    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memory_records_scope_updated
  ON memory_records(agent_id, workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_records_kind_updated
  ON memory_records(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_records_provider
  ON memory_records(provider_id, updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts USING fts5(
  content,
  record_id UNINDEXED,
  provider_id UNINDEXED,
  kind UNINDEXED,
  agent_id UNINDEXED,
  workspace_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS memory_signals (
  signal_id     TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  record_id     TEXT,
  provider_id   TEXT,
  agent_id      TEXT,
  workspace_id  TEXT,
  session_key   TEXT,
  score         REAL,
  content       TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (record_id) REFERENCES memory_records(record_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_signals_created
  ON memory_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_signals_record_created
  ON memory_signals(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_signals_scope_created
  ON memory_signals(agent_id, workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_provider_state (
  provider_id TEXT NOT NULL,
  scope_key   TEXT NOT NULL,
  state_json  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (provider_id, scope_key)
);

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

CREATE TABLE IF NOT EXISTS goals (
  goal_id              TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL,
  agent_id             TEXT NOT NULL,
  priority             TEXT NOT NULL DEFAULT 'normal',
  deadline_at          INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  completed_at         INTEGER,
  archived_at          INTEGER,
  active_session_key   TEXT,
  current_run_id       TEXT,
  next_action          TEXT,
  blocked_reason       TEXT,
  judge_model_ref      TEXT,
  max_turns            INTEGER NOT NULL,
  turns_used           INTEGER NOT NULL DEFAULT 0,
  ui_locale            TEXT,
  source               TEXT NOT NULL DEFAULT 'chat'
);

CREATE INDEX IF NOT EXISTS idx_goals_status_updated
  ON goals(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_goals_agent_updated
  ON goals(agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_goals_active_session
  ON goals(active_session_key);

CREATE TABLE IF NOT EXISTS work_items (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal',
  owner_agent_id  TEXT,
  next_action     TEXT,
  blocked_reason  TEXT,
  due_at          INTEGER,
  completed_at    INTEGER,
  archived_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_items_project_status
  ON work_items(project_id, status, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS work_item_links (
  id               TEXT PRIMARY KEY,
  work_item_id     TEXT NOT NULL,
  kind             TEXT NOT NULL,
  target_id        TEXT NOT NULL,
  title            TEXT,
  status_snapshot  TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_links_item
  ON work_item_links(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_item_events (
  id            TEXT PRIMARY KEY,
  work_item_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_events_item
  ON work_item_events(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_item_attachments (
  id            TEXT PRIMARY KEY,
  work_item_id  TEXT NOT NULL,
  media_uri     TEXT NOT NULL,
  media_id      TEXT NOT NULL,
  bucket        TEXT NOT NULL,
  type          TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_attachments_item
  ON work_item_attachments(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_item_update_suggestions (
  id             TEXT PRIMARY KEY,
  work_item_id   TEXT NOT NULL,
  source_kind    TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  status         TEXT NOT NULL,
  patch_json     TEXT NOT NULL DEFAULT '{}',
  progress_note  TEXT,
  rationale      TEXT,
  confidence     REAL,
  created_at     INTEGER NOT NULL,
  applied_at     INTEGER,
  dismissed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_work_item_update_suggestions_item
  ON work_item_update_suggestions(work_item_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_events (
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

CREATE INDEX IF NOT EXISTS idx_activity_events_created
  ON activity_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_events_object_created
  ON activity_events(primary_object_kind, primary_object_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_scopes (
  activity_id  TEXT NOT NULL,
  scope_kind   TEXT NOT NULL,
  scope_id     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  PRIMARY KEY (activity_id, scope_kind, scope_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_activity_scopes_scope
  ON activity_scopes(scope_kind, scope_id, activity_id);

CREATE TABLE IF NOT EXISTS object_links (
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

CREATE INDEX IF NOT EXISTS idx_object_links_from
  ON object_links(from_kind, from_id);

CREATE INDEX IF NOT EXISTS idx_object_links_to
  ON object_links(to_kind, to_id);

CREATE TABLE IF NOT EXISTS activity_related_projects (
  activity_id  TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  reason       TEXT NOT NULL,
  confidence   REAL NOT NULL,
  computed_at  INTEGER NOT NULL,
  PRIMARY KEY (activity_id, project_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_activity_related_projects_project
  ON activity_related_projects(project_id, activity_id);

CREATE TABLE IF NOT EXISTS goal_context_messages (
  goal_id           TEXT PRIMARY KEY,
  text              TEXT NOT NULL DEFAULT '',
  attachments_json  TEXT NOT NULL DEFAULT '[]',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS goal_queue (
  queue_id       TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL,
  status         TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  attempts       INTEGER NOT NULL,
  max_retries    INTEGER NOT NULL,
  enqueued_at    INTEGER NOT NULL,
  started_at     INTEGER,
  finished_at    INTEGER,
  next_run_at    INTEGER,
  session_key    TEXT,
  last_error     TEXT,
  source         TEXT NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_queue_status_next
  ON goal_queue(status, next_run_at, enqueued_at);
CREATE INDEX IF NOT EXISTS idx_goal_queue_goal_status
  ON goal_queue(goal_id, status);
CREATE INDEX IF NOT EXISTS idx_goal_queue_enqueued
  ON goal_queue(enqueued_at DESC);

CREATE TABLE IF NOT EXISTS goal_checklist_items (
  item_id            TEXT PRIMARY KEY,
  goal_id            TEXT NOT NULL,
  text               TEXT NOT NULL,
  status             TEXT NOT NULL,
  added_by           TEXT NOT NULL,
  added_at           INTEGER NOT NULL,
  completed_at       INTEGER,
  evidence_summary   TEXT,
  sort_order         INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_checklist_goal_order
  ON goal_checklist_items(goal_id, sort_order);

CREATE TABLE IF NOT EXISTS goal_runs (
  run_id              TEXT PRIMARY KEY,
  goal_id             TEXT NOT NULL,
  session_key         TEXT NOT NULL,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER,
  verdict             TEXT,
  reason              TEXT,
  next_action         TEXT,
  assistant_preview   TEXT,
  checklist_done      INTEGER,
  checklist_total     INTEGER,
  confidence          REAL,
  missing_evidence_json TEXT,
  user_question       TEXT,
  completed_checklist_item_ids_json TEXT,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_runs_goal_started
  ON goal_runs(goal_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_goal_runs_session_started
  ON goal_runs(session_key, started_at DESC);

CREATE TABLE IF NOT EXISTS goal_events (
  event_id       TEXT PRIMARY KEY,
  goal_id        TEXT NOT NULL,
  run_id         TEXT,
  kind           TEXT NOT NULL,
  message        TEXT NOT NULL,
  data_json      TEXT,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_events_goal_created
  ON goal_events(goal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS goal_evidence (
  evidence_id   TEXT PRIMARY KEY,
  goal_id       TEXT NOT NULL,
  run_id        TEXT,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,
  uri           TEXT,
  data_json     TEXT,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_evidence_goal_created
  ON goal_evidence(goal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS goal_session_links (
  goal_id       TEXT NOT NULL,
  session_key   TEXT NOT NULL,
  linked_at     INTEGER NOT NULL,
  PRIMARY KEY (goal_id, session_key),
  FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_goal_session_links_session
  ON goal_session_links(session_key, linked_at DESC);
