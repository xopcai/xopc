CREATE TABLE outcome_links_next (
  outcome_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN (
    'project', 'work_item', 'session', 'workflow',
    'automation', 'artifact', 'source'
  )),
  subject_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (outcome_id, subject_kind, subject_id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE CASCADE
);
INSERT INTO outcome_links_next
SELECT outcome_id, subject_kind, subject_id, relation, created_at
FROM outcome_links WHERE subject_kind <> 'goal';
DROP TABLE outcome_links;
ALTER TABLE outcome_links_next RENAME TO outcome_links;
CREATE INDEX idx_outcome_links_subject ON outcome_links(subject_kind, subject_id);

CREATE TABLE execution_receipts_next (
  run_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  summary TEXT,
  contract_json TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  feedback_outcome TEXT CHECK (feedback_outcome IN ('helpful', 'not_helpful')),
  feedback_reason TEXT,
  needs_correction INTEGER CHECK (needs_correction IN (0, 1)),
  support_fit INTEGER CHECK (support_fit IN (0, 1)),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('passed', 'failed', 'unverified')),
  verification_json TEXT NOT NULL DEFAULT '{"checks":[]}',
  failure_code TEXT,
  failure_phase TEXT,
  recovery_action TEXT,
  project_id TEXT,
  work_item_id TEXT,
  origin TEXT,
  trigger_kind TEXT,
  parent_run_id TEXT,
  next_action TEXT,
  needs_user INTEGER NOT NULL DEFAULT 0,
  context_trace_id TEXT,
  completion_verdict TEXT CHECK (completion_verdict IN ('achieved', 'partial', 'not_achieved')),
  completion_verdict_source TEXT CHECK (completion_verdict_source IN ('system', 'user')),
  correction_text TEXT,
  projection_version INTEGER NOT NULL DEFAULT 0,
  projected_at INTEGER,
  outcome_id TEXT,
  contract_version INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  strategy TEXT,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);
INSERT INTO execution_receipts_next (
  run_id, session_key, channel, objective, status, summary, contract_json,
  evidence_json, feedback_outcome, feedback_reason, needs_correction, support_fit,
  started_at, completed_at, updated_at, verification_status, verification_json,
  failure_code, failure_phase, recovery_action, project_id, work_item_id, origin,
  trigger_kind, parent_run_id, next_action, needs_user, context_trace_id,
  completion_verdict, completion_verdict_source, correction_text, projection_version,
  projected_at, outcome_id, contract_version, attempt, strategy
)
SELECT
  run_id, session_key, channel, objective, status, summary, contract_json,
  evidence_json, feedback_outcome, feedback_reason, needs_correction, support_fit,
  started_at, completed_at, updated_at, verification_status, verification_json,
  failure_code, failure_phase, recovery_action, project_id, work_item_id,
  CASE WHEN origin = 'goal' THEN 'outcome' ELSE origin END,
  trigger_kind, parent_run_id, next_action, needs_user, context_trace_id,
  completion_verdict, completion_verdict_source, correction_text, projection_version,
  projected_at, outcome_id, contract_version, attempt, strategy
FROM execution_receipts;
DROP TABLE execution_receipts;
ALTER TABLE execution_receipts_next RENAME TO execution_receipts;
CREATE INDEX idx_execution_receipts_session_started ON execution_receipts(session_key, started_at DESC);
CREATE INDEX idx_execution_receipts_status_started ON execution_receipts(status, started_at DESC);
CREATE INDEX idx_execution_receipts_project_updated ON execution_receipts(project_id, updated_at DESC);
CREATE INDEX idx_execution_receipts_work_item_updated ON execution_receipts(work_item_id, updated_at DESC);
CREATE INDEX idx_execution_receipts_unprojected ON execution_receipts(projection_version, completed_at DESC);
CREATE INDEX idx_execution_receipts_outcome_started ON execution_receipts(outcome_id, started_at DESC);

CREATE TABLE work_intakes_next (
  intake_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  objective TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  session_key TEXT,
  agent_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'expired', 'cancelled')),
  execution_mode TEXT NOT NULL DEFAULT 'run_now' CHECK (execution_mode IN ('create_only', 'run_now')),
  project_id TEXT,
  queue_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  updated_at INTEGER NOT NULL,
  outcome_id TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE SET NULL
);
INSERT INTO work_intakes_next (
  intake_id, idempotency_key, request_fingerprint, objective, proposal_json,
  session_key, agent_id, status, execution_mode, project_id, queue_id,
  expires_at, created_at, confirmed_at, updated_at, outcome_id
)
SELECT intake_id, idempotency_key, request_fingerprint, objective, proposal_json,
  session_key, agent_id, status, execution_mode, project_id, queue_id,
  expires_at, created_at, confirmed_at, updated_at, outcome_id
FROM work_intakes;
DROP TABLE work_intakes;
ALTER TABLE work_intakes_next RENAME TO work_intakes;
CREATE INDEX idx_work_intakes_status_updated ON work_intakes(status, updated_at DESC);
CREATE INDEX idx_work_intakes_expires ON work_intakes(status, expires_at);

CREATE TABLE workflow_runs_next (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  outcome_id TEXT,
  session_key TEXT NOT NULL,
  parent_session_key TEXT,
  status TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_json TEXT NOT NULL,
  metadata_json TEXT,
  title TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  completed_at_ms INTEGER,
  metrics_json TEXT NOT NULL,
  result_preview TEXT,
  error_message TEXT,
  project_id TEXT
);
INSERT INTO workflow_runs_next (
  run_id, agent_id, definition_id, definition_version, outcome_id, session_key,
  parent_session_key, status, source_kind, source_json, metadata_json, title,
  created_at_ms, started_at_ms, completed_at_ms, metrics_json, result_preview,
  error_message, project_id
)
SELECT run_id, agent_id, definition_id, definition_version, outcome_id, session_key,
  parent_session_key, status, source_kind, source_json, metadata_json, title,
  created_at_ms, started_at_ms, completed_at_ms, metrics_json, result_preview,
  error_message, project_id
FROM workflow_runs;
DROP TABLE workflow_runs;
ALTER TABLE workflow_runs_next RENAME TO workflow_runs;
CREATE INDEX idx_workflow_runs_created ON workflow_runs(agent_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_status_created ON workflow_runs(agent_id, status, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_definition_created ON workflow_runs(definition_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_project ON workflow_runs(project_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_outcome_created ON workflow_runs(outcome_id, created_at_ms DESC);

DELETE FROM work_item_links WHERE kind = 'goal';
DELETE FROM work_item_update_suggestions WHERE source_kind = 'goal';
DELETE FROM work_item_events WHERE type = 'goal_created';

DROP TABLE goal_context_messages;
DROP TABLE goal_queue;
DROP TABLE goal_checklist_items;
DROP TABLE goal_runs;
DROP TABLE goal_events;
DROP TABLE goal_evidence;
DROP TABLE goal_session_links;
DROP TABLE goals;
