-- One-way cutover from mixed Task status/runtime state to Task + TaskRun.
-- The migration preserves durable user data once and removes the old schema.

ALTER TABLE projects ADD COLUMN outcome TEXT;
ALTER TABLE projects ADD COLUMN success_criteria_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN scope_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN non_goals_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN health TEXT NOT NULL DEFAULT 'unknown'
  CHECK (health IN ('unknown', 'on_track', 'at_risk', 'off_track'));
ALTER TABLE projects ADD COLUMN owner_id TEXT;
ALTER TABLE projects ADD COLUMN target_at INTEGER;
ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

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
CREATE INDEX idx_project_milestones_project_sort
  ON project_milestones(project_id, sort_order, created_at);

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
CREATE INDEX idx_project_updates_project_created
  ON project_updates(project_id, created_at DESC);

ALTER TABLE tasks RENAME TO legacy_tasks;
ALTER TABLE task_contracts RENAME TO legacy_task_contracts;
ALTER TABLE task_links RENAME TO legacy_task_links;
ALTER TABLE task_queue RENAME TO legacy_task_queue;
ALTER TABLE task_dependencies RENAME TO legacy_task_dependencies;
ALTER TABLE context_snapshots RENAME TO legacy_context_snapshots;
ALTER TABLE execution_receipts RENAME TO legacy_execution_receipts;
ALTER TABLE workflow_runs RENAME TO legacy_workflow_runs;

DROP INDEX idx_tasks_request;
DROP INDEX idx_tasks_status_updated;
DROP INDEX idx_tasks_session;
DROP INDEX idx_tasks_project_updated;
DROP INDEX idx_task_links_subject;
DROP INDEX idx_task_queue_status_next;
DROP INDEX idx_task_queue_task_status;
DROP INDEX idx_task_queue_enqueued;
DROP INDEX idx_task_dependencies_upstream;
DROP INDEX idx_context_snapshots_session_created;
DROP INDEX idx_context_snapshots_task;
DROP INDEX idx_execution_receipts_session_started;
DROP INDEX idx_execution_receipts_status_started;
DROP INDEX idx_execution_receipts_project_updated;
DROP INDEX idx_execution_receipts_unprojected;
DROP INDEX idx_execution_receipts_task_started;
DROP INDEX idx_workflow_runs_created;
DROP INDEX idx_workflow_runs_status_created;
DROP INDEX idx_workflow_runs_definition_created;
DROP INDEX idx_workflow_runs_project;
DROP INDEX idx_workflow_runs_task_created;

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
  closed_at INTEGER,
  CHECK ((phase = 'closed' AND resolution IS NOT NULL) OR (phase <> 'closed' AND resolution IS NULL)),
  CHECK (parent_task_id IS NULL OR parent_task_id <> task_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL,
  FOREIGN KEY (milestone_id) REFERENCES project_milestones(milestone_id) ON DELETE SET NULL,
  FOREIGN KEY (parent_task_id) REFERENCES tasks(task_id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_tasks_creation_idempotency
  ON tasks(creation_idempotency_key) WHERE creation_idempotency_key IS NOT NULL;
CREATE INDEX idx_tasks_project_updated ON tasks(project_id, updated_at DESC);
CREATE INDEX idx_tasks_phase_updated ON tasks(phase, updated_at DESC);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id, updated_at DESC);

INSERT INTO tasks (
  task_id, creation_idempotency_key, project_id, title, body, phase, resolution,
  priority, due_at, delegate_agent_id, source, locale, latest_contract_version,
  version, created_at, updated_at, closed_at
)
SELECT
  task_id,
  request_id,
  project_id,
  CASE
    WHEN instr(trim(objective), char(10)) > 0
      THEN substr(trim(objective), 1, instr(trim(objective), char(10)) - 1)
    ELSE substr(trim(objective), 1, 500)
  END,
  NULLIF(trim(context_text), ''),
  CASE status
    WHEN 'pending' THEN 'backlog'
    WHEN 'verifying' THEN 'review'
    WHEN 'completed' THEN 'closed'
    WHEN 'cancelled' THEN 'closed'
    ELSE 'active'
  END,
  CASE status
    WHEN 'completed' THEN 'done'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE NULL
  END,
  priority,
  due_at,
  agent_id,
  source,
  ui_locale,
  latest_contract_version,
  1,
  created_at,
  updated_at,
  CASE WHEN status IN ('completed', 'cancelled') THEN updated_at ELSE NULL END
FROM legacy_tasks;

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

INSERT INTO task_contracts (
  task_id, version, objective, expected_outputs_json, acceptance_criteria_json,
  constraints_json, approval_required_json, assumptions_json, risks_json,
  acceptance_policy, output_destinations_json, created_by_json, created_at
)
SELECT
  task_id, version, objective, expected_outputs_json, acceptance_criteria_json,
  constraints_json, approval_required_json, assumptions_json, risks_json,
  'verified_then_review', '[]', json_object('kind', created_by), created_at
FROM legacy_task_contracts;

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
INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_kind, created_at)
SELECT task_id, depends_on_task_id, 'blocks', created_at
FROM legacy_task_dependencies;
CREATE INDEX idx_task_dependencies_upstream
  ON task_dependencies(depends_on_task_id, task_id);

CREATE TABLE task_sessions (
  task_session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  session_key TEXT,
  role TEXT NOT NULL CHECK (role IN ('primary', 'discussion', 'execution')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_task_sessions_identity
  ON task_sessions(task_id, session_key, role) WHERE session_key IS NOT NULL;
CREATE INDEX idx_task_sessions_session ON task_sessions(session_key, created_at DESC);

INSERT OR IGNORE INTO task_sessions (task_session_id, task_id, session_key, role, created_at)
SELECT task_id || ':primary:' || active_session_key, task_id, active_session_key, 'primary', updated_at
FROM legacy_tasks
WHERE active_session_key IS NOT NULL
  AND EXISTS (SELECT 1 FROM sessions WHERE session_key = legacy_tasks.active_session_key);

INSERT OR IGNORE INTO task_sessions (task_session_id, task_id, session_key, role, created_at)
SELECT task_id || ':discussion:' || subject_id, task_id, subject_id, 'discussion', created_at
FROM legacy_task_links
WHERE subject_kind = 'session'
  AND EXISTS (SELECT 1 FROM sessions WHERE session_key = legacy_task_links.subject_id);

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
CREATE INDEX idx_task_waits_task_status ON task_waits(task_id, status, created_at DESC);
CREATE INDEX idx_task_waits_resume ON task_waits(status, resume_at);

INSERT INTO task_waits (
  wait_id, task_id, kind, status, reason, condition_json, created_at
)
SELECT
  task_id || ':wait:dependency:' || depends_on_task_id,
  task_id,
  'dependency',
  'active',
  'Waiting for dependent task',
  json_object('dependsOnTaskId', depends_on_task_id, 'provenance', 'migration'),
  updated_at
FROM legacy_tasks
JOIN legacy_task_dependencies USING (task_id)
WHERE legacy_tasks.status = 'waiting_dependency'
  AND EXISTS (
    SELECT 1 FROM legacy_tasks upstream
    WHERE upstream.task_id = legacy_task_dependencies.depends_on_task_id
      AND upstream.status <> 'completed'
  );

INSERT INTO task_waits (
  wait_id, task_id, kind, status, reason, condition_json, created_at
)
SELECT
  task_id || ':wait:migration',
  task_id,
  CASE status
    WHEN 'needs_user' THEN
      CASE WHEN blocked_reason LIKE 'Approval required:%' THEN 'approval' ELSE 'user_input' END
    WHEN 'paused' THEN 'paused'
    ELSE 'external_event'
  END,
  'active',
  COALESCE(NULLIF(blocked_reason, ''), NULLIF(next_action, ''), 'Migrated task requires attention'),
  json_object('nextAction', next_action, 'blockedReason', blocked_reason, 'provenance', 'migration'),
  updated_at
FROM legacy_tasks
WHERE status IN ('needs_user', 'blocked', 'paused');

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
CREATE INDEX idx_task_authority_grants_task
  ON task_authority_grants(task_id, revoked_at, expires_at);

INSERT INTO task_authority_grants (
  grant_id, task_id, capability, scope_json, granted_by_json, granted_at
)
SELECT
  legacy_tasks.task_id || ':grant:' || approved.key,
  legacy_tasks.task_id,
  approved.value,
  '{}',
  json_object('kind', 'user'),
  legacy_tasks.updated_at
FROM legacy_tasks, json_each(legacy_tasks.approved_boundaries_json) approved;

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
CREATE INDEX idx_context_edges_owner
  ON context_edges(owner_kind, owner_id, role, created_at);
CREATE INDEX idx_context_edges_target
  ON context_edges(target_kind, target_id, created_at);

INSERT OR IGNORE INTO context_edges (
  edge_id, owner_kind, owner_id, target_kind, target_id, role, pinned,
  retrieval_policy_json, metadata_json, created_by_json, created_at, updated_at
)
SELECT
  legacy_tasks.task_id || ':attachment:' || attachment.key,
  'task',
  legacy_tasks.task_id,
  'file',
  COALESCE(
    json_extract(attachment.value, '$.id'),
    json_extract(attachment.value, '$.uri'),
    legacy_tasks.task_id || ':attachment:' || attachment.key
  ),
  'input',
  1,
  '{}',
  attachment.value,
  json_object('kind', 'user'),
  legacy_tasks.created_at,
  legacy_tasks.updated_at
FROM legacy_tasks, json_each(legacy_tasks.context_attachments_json) attachment;

INSERT OR IGNORE INTO context_edges (
  edge_id, owner_kind, owner_id, target_kind, target_id, role, pinned,
  retrieval_policy_json, metadata_json, created_by_json, created_at, updated_at
)
SELECT
  task_id || ':link:' || subject_kind || ':' || subject_id,
  'task', task_id, subject_kind, subject_id, 'reference', 0, '{}',
  json_object('relation', relation), json_object('kind', 'system'), created_at, created_at
FROM legacy_task_links
WHERE subject_kind IN ('artifact', 'source');

CREATE TABLE context_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('task_run', 'task', 'session', 'proactive_run')),
  owner_id TEXT NOT NULL,
  session_key TEXT,
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
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE SET NULL
);
CREATE INDEX idx_context_snapshots_owner
  ON context_snapshots(owner_kind, owner_id, created_at DESC);
CREATE INDEX idx_context_snapshots_session
  ON context_snapshots(session_key, created_at DESC);

INSERT INTO context_snapshots (
  snapshot_id, trace_id, owner_kind, owner_id, session_key, query,
  selected_items_json, rejected_items_json, consent_requests_json,
  relationship_policy_json, estimated_tokens, allocation_json, created_at
)
SELECT
  snapshot_id,
  trace_id,
  CASE
    WHEN run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM legacy_execution_receipts receipt WHERE receipt.run_id = legacy_context_snapshots.run_id
    ) THEN 'task_run'
    WHEN task_id IS NOT NULL THEN 'task'
    ELSE 'session'
  END,
  CASE
    WHEN run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM legacy_execution_receipts receipt WHERE receipt.run_id = legacy_context_snapshots.run_id
    ) THEN run_id
    WHEN task_id IS NOT NULL THEN task_id
    ELSE session_key
  END,
  CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE sessions.session_key = legacy_context_snapshots.session_key)
    THEN session_key ELSE NULL END,
  query, selected_items_json, rejected_items_json, consent_requests_json,
  relationship_policy_json, estimated_tokens, allocation_json, created_at
FROM legacy_context_snapshots;

INSERT INTO context_snapshots (
  snapshot_id, trace_id, owner_kind, owner_id, session_key, query,
  selected_items_json, rejected_items_json, consent_requests_json,
  relationship_policy_json, estimated_tokens, authorization_snapshot_json,
  content_hash, created_at
)
SELECT
  'migration:context:' || receipt.run_id,
  'migration:trace:' || receipt.run_id,
  'task_run',
  receipt.run_id,
  CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE session_key = receipt.session_key)
    THEN receipt.session_key ELSE NULL END,
  receipt.objective,
  '[]', '[]', '[]', '{}', 0, '{}', NULL, receipt.started_at
FROM legacy_execution_receipts receipt
WHERE receipt.task_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM context_snapshots snapshot
    WHERE snapshot.owner_kind = 'task_run' AND snapshot.owner_id = receipt.run_id
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
  executor_kind TEXT NOT NULL CHECK (executor_kind IN ('agent', 'workflow', 'human', 'external')),
  executor_ref_json TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  contract_version INTEGER NOT NULL,
  context_snapshot_id TEXT,
  policy_snapshot_json TEXT,
  session_key TEXT,
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
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (root_run_id) REFERENCES task_runs(run_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (parent_run_id) REFERENCES task_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (retry_of_run_id) REFERENCES task_runs(run_id) ON DELETE SET NULL,
  FOREIGN KEY (context_snapshot_id) REFERENCES context_snapshots(snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE SET NULL,
  FOREIGN KEY (task_id, contract_version) REFERENCES task_contracts(task_id, version) ON DELETE RESTRICT
);
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

INSERT INTO task_runs (
  run_id, task_id, root_run_id, attempt, status, executor_kind,
  executor_ref_json, trigger_json, correlation_id, causation_id,
  idempotency_key, contract_version, context_snapshot_id, policy_snapshot_json,
  session_key, queued_at, started_at, completed_at, retry_policy_json,
  retry_of_run_id, terminal_code, terminal_message, version
)
SELECT
  receipt.run_id,
  receipt.task_id,
  receipt.run_id,
  receipt.attempt,
  CASE receipt.status
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'failed'
  END,
  CASE WHEN EXISTS (
    SELECT 1 FROM legacy_workflow_runs workflow
    WHERE workflow.task_id = receipt.task_id AND workflow.session_key = receipt.session_key
  ) THEN 'workflow' ELSE 'agent' END,
  json_object('origin', COALESCE(receipt.origin, 'agent')),
  json_object('kind', COALESCE(receipt.trigger_kind, 'migration')),
  'migration:' || receipt.run_id,
  NULL,
  'migration:receipt:' || receipt.run_id,
  COALESCE(receipt.contract_version, 1),
  (SELECT snapshot_id FROM context_snapshots
   WHERE owner_kind = 'task_run' AND owner_id = receipt.run_id
   ORDER BY created_at DESC LIMIT 1),
  '{}',
  CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE session_key = receipt.session_key)
    THEN receipt.session_key ELSE NULL END,
  receipt.started_at,
  receipt.started_at,
  COALESCE(receipt.completed_at, receipt.updated_at),
  '{}',
  receipt.parent_run_id,
  CASE WHEN receipt.status = 'running' THEN 'migration_interrupted' ELSE receipt.failure_code END,
  CASE WHEN receipt.status = 'running' THEN 'Interrupted by TaskRun migration' ELSE NULL END,
  1
FROM legacy_execution_receipts receipt
WHERE receipt.task_id IS NOT NULL;

INSERT INTO task_runs (
  run_id, task_id, root_run_id, attempt, status, executor_kind,
  executor_ref_json, trigger_json, correlation_id, idempotency_key,
  contract_version, session_key, queued_at, scheduled_at, retry_policy_json, version
)
SELECT
  queue.queue_id,
  queue.task_id,
  queue.queue_id,
  COALESCE((SELECT MAX(attempt) FROM task_runs WHERE task_id = queue.task_id), 0) + 1,
  'queued',
  'agent',
  json_object('agentId', task.delegate_agent_id),
  json_object('kind', queue.source),
  'migration:' || queue.queue_id,
  'migration:queue:' || queue.queue_id,
  task.latest_contract_version,
  CASE WHEN EXISTS (SELECT 1 FROM sessions WHERE session_key = queue.session_key)
    THEN queue.session_key ELSE NULL END,
  queue.enqueued_at,
  CASE WHEN queue.status IN ('scheduled', 'retry_waiting') THEN queue.next_run_at ELSE NULL END,
  json_object('maxAttempts', queue.max_retries + 1),
  1
FROM legacy_task_queue queue
JOIN tasks task ON task.task_id = queue.task_id
WHERE queue.status IN ('queued', 'scheduled', 'retry_waiting')
  AND task.phase <> 'closed'
  AND queue.queue_id = (
    SELECT candidate.queue_id FROM legacy_task_queue candidate
    WHERE candidate.task_id = queue.task_id
      AND candidate.status IN ('queued', 'scheduled', 'retry_waiting')
    ORDER BY candidate.enqueued_at DESC LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM task_runs active
    WHERE active.task_id = queue.task_id
      AND active.status IN ('queued', 'running', 'waiting', 'verifying')
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
CREATE INDEX idx_task_run_events_run_sequence ON task_run_events(run_id, sequence);

INSERT INTO task_run_events (event_id, run_id, sequence, type, payload_json, actor_json, occurred_at)
SELECT run_id || ':migration', run_id, 1, 'task_run.migrated', '{}', json_object('kind', 'system'), queued_at
FROM task_runs;

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

INSERT INTO task_run_receipts (
  run_id, status, summary, evidence_json, verification_json,
  remaining_work_json, next_action, needs_user, completion_verdict,
  failure_json, judgment_json, context_trace_id, finalized_at
)
SELECT
  receipt.run_id,
  CASE receipt.status
    WHEN 'succeeded' THEN 'succeeded'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'failed'
  END,
  COALESCE(receipt.summary, ''),
  receipt.evidence_json,
  json_object(
    'status', receipt.verification_status,
    'checks', COALESCE(json_extract(receipt.verification_json, '$.checks'), json('[]'))
  ),
  '[]',
  receipt.next_action,
  receipt.needs_user,
  receipt.completion_verdict,
  CASE WHEN receipt.failure_code IS NULL AND receipt.status <> 'running' THEN NULL ELSE json_object(
    'code', COALESCE(receipt.failure_code, 'migration_interrupted'),
    'phase', COALESCE(receipt.failure_phase, 'runtime'),
    'recoveryAction', COALESCE(receipt.recovery_action, 'none')
  ) END,
  receipt.judgment_json,
  receipt.context_trace_id,
  COALESCE(receipt.completed_at, receipt.updated_at)
FROM legacy_execution_receipts receipt
WHERE receipt.task_id IS NOT NULL;

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

INSERT INTO task_run_feedback (
  feedback_id, run_id, rating, reason, needs_correction, support_fit, created_at
)
SELECT
  run_id || ':feedback', run_id, feedback_rating, feedback_reason,
  needs_correction, support_fit, updated_at
FROM legacy_execution_receipts
WHERE task_id IS NOT NULL AND feedback_rating IS NOT NULL;

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
);
CREATE INDEX idx_domain_outbox_pending ON domain_outbox(published_at, created_at);

CREATE TABLE workflow_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  task_run_id TEXT,
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
  FOREIGN KEY (task_run_id) REFERENCES task_runs(run_id) ON DELETE SET NULL
);

INSERT INTO workflow_runs (
  run_id, agent_id, definition_id, definition_version, task_run_id,
  session_key, parent_session_key, status, source_kind, source_json,
  metadata_json, title, created_at_ms, started_at_ms, completed_at_ms,
  metrics_json, result_preview, error_message, project_id
)
SELECT
  workflow.run_id, workflow.agent_id, workflow.definition_id, workflow.definition_version,
  CASE WHEN workflow.task_id IS NULL THEN NULL ELSE (
    SELECT task_run.run_id FROM task_runs task_run
    WHERE task_run.task_id = workflow.task_id
      AND task_run.executor_kind = 'workflow'
    ORDER BY ABS(task_run.queued_at - workflow.created_at_ms) ASC LIMIT 1
  ) END,
  workflow.session_key, workflow.parent_session_key, workflow.status,
  workflow.source_kind, workflow.source_json, workflow.metadata_json, workflow.title,
  workflow.created_at_ms, workflow.started_at_ms, workflow.completed_at_ms,
  workflow.metrics_json, workflow.result_preview, workflow.error_message, workflow.project_id
FROM legacy_workflow_runs workflow;

CREATE INDEX idx_workflow_runs_created ON workflow_runs(agent_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_status_created ON workflow_runs(agent_id, status, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_definition_created ON workflow_runs(definition_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_project ON workflow_runs(project_id, created_at_ms DESC);
CREATE INDEX idx_workflow_runs_task_run ON workflow_runs(task_run_id, created_at_ms DESC);

DELETE FROM proactive_events WHERE type LIKE 'task.%';
UPDATE proactive_scenarios
SET event_types_json = '["project.updated.v1","task.phase_changed.v2","task.attention_required.v2"]',
    condition_json = NULL,
    version = version + 1,
    updated_at = datetime('now')
WHERE scenario_key = 'project_delivery_risk';
UPDATE proactive_scenarios
SET event_types_json = '["task.attention_required.v2"]',
    condition_json = NULL,
    version = version + 1,
    updated_at = datetime('now')
WHERE scenario_key = 'blocked_work';
UPDATE automations
SET enabled = 0, updated_at_ms = unixepoch('subsec') * 1000
WHERE trigger_json LIKE '%task.status_changed%';

DROP TABLE legacy_workflow_runs;
DROP TABLE legacy_execution_receipts;
DROP TABLE legacy_context_snapshots;
DROP TABLE legacy_task_queue;
DROP TABLE legacy_task_links;
DROP TABLE legacy_task_dependencies;
DROP TABLE legacy_task_contracts;
DROP TABLE legacy_tasks;
