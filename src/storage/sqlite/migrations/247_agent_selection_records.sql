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
  selection_source TEXT NOT NULL CHECK(selection_source IN ('snapshot','match','explicit','legacy')),
  reason_source TEXT NOT NULL CHECK(reason_source IN ('model','system')),
  selection_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending_connection','rejected','task_linked','start_blocked','start_failed')),
  reason_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id, idempotency_key)
);
CREATE INDEX agent_selection_task ON agent_selection_records(task_id, created_at);
CREATE INDEX agent_selection_request ON agent_selection_records(personal_request_id);
CREATE INDEX agent_selection_origin ON agent_selection_records(conversation_id, created_at);
