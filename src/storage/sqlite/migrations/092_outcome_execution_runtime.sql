CREATE TABLE outcome_execution_state (
  outcome_id TEXT PRIMARY KEY,
  description TEXT,
  agent_id TEXT NOT NULL DEFAULT 'main',
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high')),
  active_session_key TEXT,
  next_action TEXT,
  blocked_reason TEXT,
  ui_locale TEXT CHECK (ui_locale IS NULL OR ui_locale IN ('en', 'zh')),
  source TEXT NOT NULL DEFAULT 'chat',
  project_id TEXT,
  context_text TEXT,
  context_attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

CREATE INDEX idx_outcome_execution_session
  ON outcome_execution_state(active_session_key);
CREATE INDEX idx_outcome_execution_project
  ON outcome_execution_state(project_id, updated_at DESC);

INSERT INTO outcome_execution_state (
  outcome_id, description, agent_id, priority, active_session_key,
  next_action, blocked_reason, ui_locale, source, project_id,
  context_text, context_attachments_json, created_at, updated_at
)
SELECT
  goals.outcome_id, goals.description, goals.agent_id, goals.priority,
  goals.active_session_key, goals.next_action, goals.blocked_reason,
  goals.ui_locale, goals.source, goals.project_id,
  goal_context_messages.text,
  COALESCE(goal_context_messages.attachments_json, '[]'),
  goals.created_at, goals.updated_at
FROM goals
LEFT JOIN goal_context_messages ON goal_context_messages.goal_id = goals.goal_id
WHERE goals.outcome_id IS NOT NULL;

CREATE TABLE outcome_queue (
  queue_id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  status TEXT NOT NULL,
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
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE CASCADE
);

CREATE INDEX idx_outcome_queue_status_next
  ON outcome_queue(status, next_run_at, enqueued_at);
CREATE INDEX idx_outcome_queue_outcome_status
  ON outcome_queue(outcome_id, status);
CREATE INDEX idx_outcome_queue_enqueued
  ON outcome_queue(enqueued_at DESC);

INSERT INTO outcome_queue (
  queue_id, outcome_id, status, payload_json, attempts, max_retries,
  enqueued_at, started_at, finished_at, next_run_at, session_key,
  last_error, source
)
SELECT
  goal_queue.queue_id, goals.outcome_id, goal_queue.status,
  goal_queue.payload_json, goal_queue.attempts, goal_queue.max_retries,
  goal_queue.enqueued_at, goal_queue.started_at, goal_queue.finished_at,
  goal_queue.next_run_at, goal_queue.session_key, goal_queue.last_error,
  goal_queue.source
FROM goal_queue
JOIN goals ON goals.goal_id = goal_queue.goal_id
WHERE goals.outcome_id IS NOT NULL;

ALTER TABLE workflow_runs ADD COLUMN outcome_id TEXT;
UPDATE workflow_runs
SET outcome_id = (
  SELECT goals.outcome_id FROM goals WHERE goals.goal_id = workflow_runs.goal_id
)
WHERE goal_id IS NOT NULL;
CREATE INDEX idx_workflow_runs_outcome_created
  ON workflow_runs(outcome_id, created_at_ms DESC);
