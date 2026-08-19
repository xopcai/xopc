-- One-way migration from the released outcome/work-item schema to the unified Task model.
-- The old tables are transformed once and dropped; runtime compatibility is intentionally absent.

CREATE TABLE outcome_links_next (
  outcome_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN (
    'project', 'session', 'workflow', 'automation', 'artifact', 'source'
  )),
  subject_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (outcome_id, subject_kind, subject_id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE CASCADE
);
INSERT INTO outcome_links_next
SELECT outcome_id, subject_kind, subject_id, relation, created_at
FROM outcome_links WHERE subject_kind <> 'work_item';
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
  judgment_json TEXT,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);
INSERT INTO execution_receipts_next (
  run_id, session_key, channel, objective, status, summary, contract_json,
  evidence_json, feedback_outcome, feedback_reason, needs_correction, support_fit,
  started_at, completed_at, updated_at, verification_status, verification_json,
  failure_code, failure_phase, recovery_action, project_id, origin, trigger_kind,
  parent_run_id, next_action, needs_user, context_trace_id, completion_verdict,
  completion_verdict_source, correction_text, projection_version, projected_at,
  outcome_id, contract_version, attempt, strategy, judgment_json
)
SELECT
  run_id, session_key, channel, objective, status, summary, contract_json,
  evidence_json, feedback_outcome, feedback_reason, needs_correction, support_fit,
  started_at, completed_at, updated_at, verification_status, verification_json,
  failure_code, failure_phase, recovery_action, project_id, origin, trigger_kind,
  parent_run_id, next_action, needs_user, context_trace_id, completion_verdict,
  completion_verdict_source, correction_text, projection_version, projected_at,
  outcome_id, contract_version, attempt, strategy, judgment_json
FROM execution_receipts;
DROP TABLE execution_receipts;
ALTER TABLE execution_receipts_next RENAME TO execution_receipts;
CREATE INDEX idx_execution_receipts_session_started ON execution_receipts(session_key, started_at DESC);
CREATE INDEX idx_execution_receipts_status_started ON execution_receipts(status, started_at DESC);
CREATE INDEX idx_execution_receipts_project_updated ON execution_receipts(project_id, updated_at DESC);
CREATE INDEX idx_execution_receipts_unprojected ON execution_receipts(projection_version, completed_at DESC);
CREATE INDEX idx_execution_receipts_outcome_started ON execution_receipts(outcome_id, started_at DESC);

DELETE FROM proactive_events WHERE subject_kind = 'work_item' OR type LIKE 'work_item.%';
UPDATE proactive_scenarios
SET event_types_json = '["project.updated.v1","outcome.status_changed.v1"]'
WHERE scenario_key = 'project_delivery_risk';
UPDATE proactive_scenarios
SET event_types_json = '["outcome.status_changed.v1"]',
    condition_json = '{"op":"in","field":"payload.internalStatus","values":["needs_user","blocked"]}'
WHERE scenario_key = 'blocked_work';

DROP TABLE IF EXISTS work_item_command_proposals;
DROP TABLE IF EXISTS work_item_waits;
DROP TABLE IF EXISTS work_item_attachments;
DROP TABLE IF EXISTS work_item_events;
DROP TABLE IF EXISTS work_item_links;
DROP TABLE IF EXISTS work_item_update_suggestions;
DROP TABLE IF EXISTS work_items;
ALTER TABLE outcomes ADD COLUMN request_id TEXT;
ALTER TABLE outcomes ADD COLUMN description TEXT;
ALTER TABLE outcomes ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
ALTER TABLE outcomes ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high'));
ALTER TABLE outcomes ADD COLUMN active_session_key TEXT;
ALTER TABLE outcomes ADD COLUMN next_action TEXT;
ALTER TABLE outcomes ADD COLUMN blocked_reason TEXT;
ALTER TABLE outcomes ADD COLUMN ui_locale TEXT
  CHECK (ui_locale IS NULL OR ui_locale IN ('en', 'zh'));
ALTER TABLE outcomes ADD COLUMN source TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE outcomes ADD COLUMN project_id TEXT;
ALTER TABLE outcomes ADD COLUMN context_text TEXT;
ALTER TABLE outcomes ADD COLUMN context_attachments_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE outcomes ADD COLUMN approved_boundaries_json TEXT NOT NULL DEFAULT '[]';

UPDATE outcomes
SET request_id = (SELECT request_id FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    description = (SELECT description FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    agent_id = COALESCE((SELECT agent_id FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id), 'main'),
    priority = COALESCE((SELECT priority FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id), 'normal'),
    active_session_key = (SELECT active_session_key FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    next_action = (SELECT next_action FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    blocked_reason = (SELECT blocked_reason FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    ui_locale = (SELECT ui_locale FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    source = COALESCE((SELECT source FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id), 'chat'),
    project_id = (SELECT project_id FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    context_text = (SELECT context_text FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id),
    context_attachments_json = COALESCE((SELECT context_attachments_json FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id), '[]'),
    approved_boundaries_json = COALESCE((SELECT approved_boundaries_json FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id), '[]'),
    updated_at = MAX(updated_at, COALESCE((SELECT updated_at FROM outcome_execution_state WHERE outcome_id = outcomes.outcome_id), updated_at));

DROP TABLE outcome_execution_state;

CREATE UNIQUE INDEX idx_outcomes_request
  ON outcomes(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_outcomes_session
  ON outcomes(active_session_key);
CREATE INDEX idx_outcomes_project_updated
  ON outcomes(project_id, updated_at DESC);
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  request_id TEXT,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'planning', 'waiting_dependency', 'running', 'verifying',
    'needs_user', 'blocked', 'paused', 'completed', 'cancelled'
  )),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  due_at INTEGER,
  latest_contract_version INTEGER NOT NULL DEFAULT 1,
  latest_receipt_run_id TEXT,
  agent_id TEXT NOT NULL DEFAULT 'main',
  active_session_key TEXT,
  next_action TEXT,
  blocked_reason TEXT,
  ui_locale TEXT CHECK (ui_locale IS NULL OR ui_locale IN ('en', 'zh')),
  source TEXT NOT NULL DEFAULT 'chat',
  project_id TEXT,
  context_text TEXT,
  context_attachments_json TEXT NOT NULL DEFAULT '[]',
  approved_boundaries_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

INSERT INTO tasks (
  task_id, request_id, objective, status, priority, due_at,
  latest_contract_version, latest_receipt_run_id, agent_id,
  active_session_key, next_action, blocked_reason, ui_locale, source,
  project_id, context_text, context_attachments_json, approved_boundaries_json,
  created_at, updated_at
)
SELECT
  outcome_id, request_id, objective,
  CASE internal_status
    WHEN 'captured' THEN 'pending'
    WHEN 'continuing' THEN 'running'
    ELSE internal_status
  END,
  CASE
    WHEN importance = 'critical' THEN 'critical'
    WHEN importance = 'high' OR priority = 'high' THEN 'high'
    WHEN importance = 'low' AND priority = 'low' THEN 'low'
    ELSE 'normal'
  END,
  due_at, latest_contract_version, latest_receipt_run_id, agent_id,
  active_session_key, next_action, blocked_reason, ui_locale, source,
  project_id, context_text, context_attachments_json, approved_boundaries_json,
  created_at, updated_at
FROM outcomes;

CREATE UNIQUE INDEX idx_tasks_request
  ON tasks(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_tasks_status_updated ON tasks(status, updated_at DESC);
CREATE INDEX idx_tasks_session ON tasks(active_session_key);
CREATE INDEX idx_tasks_project_updated ON tasks(project_id, updated_at DESC);

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
  context_snapshot_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'system' CHECK (created_by IN ('user', 'system')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, version),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

INSERT INTO task_contracts (
  task_id, version, objective, expected_outputs_json, acceptance_criteria_json,
  constraints_json, approval_required_json, assumptions_json, risks_json,
  context_snapshot_id, created_by, created_at
)
SELECT
  outcome_id, version, objective, deliverables_json, acceptance_criteria_json,
  constraints_json, approval_required_json, assumptions_json, risks_json,
  context_snapshot_id, created_by, created_at
FROM outcome_contracts;

CREATE TABLE task_links (
  task_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN (
    'project', 'session', 'workflow', 'automation', 'artifact', 'source'
  )),
  subject_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, subject_kind, subject_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

INSERT INTO task_links (task_id, subject_kind, subject_id, relation, created_at)
SELECT outcome_id, subject_kind, subject_id, relation, created_at
FROM outcome_links;

CREATE INDEX idx_task_links_subject ON task_links(subject_kind, subject_id);

CREATE TABLE task_queue (
  queue_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'scheduled', 'running', 'retry_waiting', 'succeeded', 'failed', 'skipped'
  )),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  max_retries INTEGER NOT NULL,
  enqueued_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  next_run_at INTEGER,
  session_key TEXT,
  last_error TEXT,
  source TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

INSERT INTO task_queue (
  queue_id, task_id, status, payload_json, attempts, max_retries,
  enqueued_at, started_at, finished_at, next_run_at, session_key, last_error, source
)
SELECT
  queue_id, outcome_id, status, payload_json, attempts, max_retries,
  enqueued_at, started_at, finished_at, next_run_at, session_key, last_error, source
FROM outcome_queue;

CREATE INDEX idx_task_queue_status_next ON task_queue(status, next_run_at, enqueued_at);
CREATE INDEX idx_task_queue_task_status ON task_queue(task_id, status);
CREATE INDEX idx_task_queue_enqueued ON task_queue(enqueued_at DESC);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

CREATE INDEX idx_task_dependencies_upstream
  ON task_dependencies(depends_on_task_id, task_id);

CREATE TABLE context_snapshots_next (
  snapshot_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  query TEXT NOT NULL,
  selected_items_json TEXT NOT NULL DEFAULT '[]',
  rejected_items_json TEXT NOT NULL DEFAULT '[]',
  consent_requests_json TEXT NOT NULL DEFAULT '[]',
  relationship_policy_json TEXT NOT NULL DEFAULT '{}',
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  allocation_json TEXT,
  task_id TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE SET NULL
);

INSERT INTO context_snapshots_next (
  snapshot_id, trace_id, session_key, query, selected_items_json,
  rejected_items_json, consent_requests_json, relationship_policy_json,
  estimated_tokens, allocation_json, task_id, run_id, created_at
)
SELECT
  snapshot_id, trace_id, session_key, query,
  replace(replace(selected_items_json, '"kind":"outcome"', '"kind":"task"'), 'outcome:', 'task:'),
  replace(replace(rejected_items_json, '"kind":"outcome"', '"kind":"task"'), 'outcome:', 'task:'),
  consent_requests_json, relationship_policy_json, estimated_tokens, allocation_json,
  outcome_id, run_id, created_at
FROM context_snapshots;

DROP TABLE context_snapshots;
ALTER TABLE context_snapshots_next RENAME TO context_snapshots;
CREATE INDEX idx_context_snapshots_session_created ON context_snapshots(session_key, created_at DESC);
CREATE INDEX idx_context_snapshots_task ON context_snapshots(task_id, created_at DESC);

CREATE TABLE execution_receipts_next (
  run_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
  summary TEXT,
  contract_json TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  feedback_rating TEXT CHECK (feedback_rating IN ('helpful', 'not_helpful')),
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
  task_id TEXT,
  contract_version INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  strategy TEXT,
  judgment_json TEXT,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE SET NULL
);

INSERT INTO execution_receipts_next (
  run_id, session_key, channel, objective, status, summary, contract_json,
  evidence_json, feedback_rating, feedback_reason, needs_correction, support_fit,
  started_at, completed_at, updated_at, verification_status, verification_json,
  failure_code, failure_phase, recovery_action, project_id, origin, trigger_kind,
  parent_run_id, next_action, needs_user, context_trace_id, completion_verdict,
  completion_verdict_source, correction_text, projection_version, projected_at,
  task_id, contract_version, attempt, strategy, judgment_json
)
SELECT
  run_id, session_key, channel, objective, status, summary,
  replace(replace(contract_json, '"outcomeId"', '"taskId"'), '"outcome"', '"task"'),
  replace(replace(evidence_json, '"outcomeId"', '"taskId"'), 'outcome:', 'task:'),
  feedback_outcome, feedback_reason, needs_correction, support_fit,
  started_at, completed_at, updated_at, verification_status, verification_json,
  failure_code, failure_phase, recovery_action, project_id,
  CASE WHEN origin = 'outcome' THEN 'task' ELSE origin END,
  trigger_kind, parent_run_id, next_action, needs_user, context_trace_id,
  completion_verdict, completion_verdict_source, correction_text,
  projection_version, projected_at, outcome_id, contract_version, attempt,
  strategy, judgment_json
FROM execution_receipts;

DROP TABLE execution_receipts;
ALTER TABLE execution_receipts_next RENAME TO execution_receipts;
CREATE INDEX idx_execution_receipts_session_started ON execution_receipts(session_key, started_at DESC);
CREATE INDEX idx_execution_receipts_status_started ON execution_receipts(status, started_at DESC);
CREATE INDEX idx_execution_receipts_project_updated ON execution_receipts(project_id, updated_at DESC);
CREATE INDEX idx_execution_receipts_unprojected ON execution_receipts(projection_version, completed_at DESC);
CREATE INDEX idx_execution_receipts_task_started ON execution_receipts(task_id, started_at DESC);

CREATE TABLE workflow_runs_next (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  task_id TEXT,
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
  project_id TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE SET NULL
);

INSERT INTO workflow_runs_next (
  run_id, agent_id, definition_id, definition_version, task_id, session_key,
  parent_session_key, status, source_kind, source_json, metadata_json, title,
  created_at_ms, started_at_ms, completed_at_ms, metrics_json, result_preview,
  error_message, project_id
)
SELECT
  run_id, agent_id, definition_id, definition_version, outcome_id, session_key,
  parent_session_key, status, source_kind, source_json,
  CASE WHEN metadata_json IS NULL THEN NULL ELSE
    replace(replace(metadata_json, '"outcomeId"', '"taskId"'), '"kind":"outcome"', '"kind":"task"')
  END,
  title, created_at_ms, started_at_ms, completed_at_ms, metrics_json,
  result_preview, error_message, project_id
FROM workflow_runs;

DROP TABLE workflow_runs;
ALTER TABLE workflow_runs_next RENAME TO workflow_runs;
CREATE INDEX idx_workflow_runs_created ON workflow_runs(agent_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_status_created ON workflow_runs(agent_id, status, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_definition_created ON workflow_runs(definition_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_project ON workflow_runs(project_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_task_created ON workflow_runs(task_id, created_at_ms DESC);

UPDATE activity_events
SET type = CASE
      WHEN type = 'outcome.created' THEN 'task.created'
      WHEN type = 'outcome.status_changed' THEN 'task.status_changed'
      ELSE type
    END,
    primary_object_kind = CASE WHEN primary_object_kind = 'outcome' THEN 'task' ELSE primary_object_kind END,
    payload_json = replace(replace(payload_json, '"outcomeId"', '"taskId"'), 'outcome:', 'task:');

UPDATE object_links SET from_kind = 'task' WHERE from_kind = 'outcome';
UPDATE object_links SET to_kind = 'task' WHERE to_kind = 'outcome';

UPDATE proactive_events
SET type = replace(type, 'outcome.', 'task.'),
    source_kind = CASE WHEN source_kind = 'outcomes' THEN 'tasks' ELSE source_kind END,
    source_id = CASE WHEN source_id = 'outcomes' THEN 'tasks' ELSE source_id END,
    subject_kind = CASE WHEN subject_kind = 'outcome' THEN 'task' ELSE subject_kind END,
    payload_json = replace(replace(payload_json, '"outcomeId"', '"taskId"'), 'outcome:', 'task:')
WHERE type LIKE 'outcome.%' OR subject_kind = 'outcome' OR source_kind = 'outcomes';

UPDATE proactive_scenarios
SET event_types_json = replace(event_types_json, 'outcome.', 'task.'),
    condition_json = replace(condition_json, 'internalStatus', 'status')
WHERE event_types_json LIKE '%outcome.%' OR condition_json LIKE '%internalStatus%';

UPDATE automations
SET trigger_json = json_set(
  trigger_json,
  '$.eventType', replace(json_extract(trigger_json, '$.eventType'), 'outcome.', 'task.'),
  '$.source', CASE WHEN json_extract(trigger_json, '$.source') = 'outcomes' THEN 'tasks'
                   ELSE json_extract(trigger_json, '$.source') END
)
WHERE json_extract(trigger_json, '$.eventType') LIKE 'outcome.%'
   OR json_extract(trigger_json, '$.source') = 'outcomes';

UPDATE mobile_activity_events
SET event_type = replace(event_type, 'outcome.', 'task.'),
    entity_kind = CASE WHEN entity_kind = 'outcome' THEN 'task' ELSE entity_kind END,
    deep_link = replace(deep_link, '/outcomes/', '/tasks/'),
    payload_json = replace(
      replace(replace(payload_json, '"outcomeId"', '"taskId"'), '/outcomes/', '/tasks/'),
      '"kind":"outcome"', '"kind":"task"'
    )
WHERE event_type LIKE 'outcome.%' OR entity_kind = 'outcome' OR deep_link LIKE '/outcomes/%';

DROP TABLE outcome_queue;
DROP TABLE outcome_links;
DROP TABLE outcome_contracts;
DROP TABLE outcomes;
