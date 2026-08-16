CREATE TABLE outcomes (
  outcome_id TEXT PRIMARY KEY,
  objective TEXT NOT NULL,
  user_status TEXT NOT NULL DEFAULT 'running'
    CHECK (user_status IN ('running', 'needs_user', 'completed')),
  internal_status TEXT NOT NULL DEFAULT 'captured'
    CHECK (internal_status IN (
      'captured', 'planning', 'running', 'verifying', 'continuing',
      'needs_user', 'blocked', 'paused', 'completed', 'cancelled'
    )),
  importance TEXT NOT NULL DEFAULT 'normal'
    CHECK (importance IN ('low', 'normal', 'high', 'critical')),
  due_at INTEGER,
  latest_contract_version INTEGER NOT NULL DEFAULT 1,
  latest_receipt_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_outcomes_status_updated
  ON outcomes(user_status, updated_at DESC);

CREATE TABLE outcome_contracts (
  outcome_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  objective TEXT NOT NULL,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  approval_required_json TEXT NOT NULL DEFAULT '[]',
  context_snapshot_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'system'
    CHECK (created_by IN ('user', 'system')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (outcome_id, version),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE CASCADE
);

CREATE TABLE outcome_links (
  outcome_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL
    CHECK (subject_kind IN (
      'project', 'goal', 'work_item', 'session', 'workflow',
      'automation', 'artifact', 'source'
    )),
  subject_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (outcome_id, subject_kind, subject_id),
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE CASCADE
);

CREATE INDEX idx_outcome_links_subject
  ON outcome_links(subject_kind, subject_id);

ALTER TABLE task_outcomes RENAME TO execution_receipts;

DROP INDEX IF EXISTS idx_task_outcomes_session_started;
DROP INDEX IF EXISTS idx_task_outcomes_status_started;
DROP INDEX IF EXISTS idx_task_outcomes_project_updated;
DROP INDEX IF EXISTS idx_task_outcomes_work_item_updated;
DROP INDEX IF EXISTS idx_task_outcomes_unprojected;

CREATE INDEX idx_execution_receipts_session_started
  ON execution_receipts(session_key, started_at DESC);
CREATE INDEX idx_execution_receipts_status_started
  ON execution_receipts(status, started_at DESC);
CREATE INDEX idx_execution_receipts_project_updated
  ON execution_receipts(project_id, updated_at DESC);
CREATE INDEX idx_execution_receipts_work_item_updated
  ON execution_receipts(work_item_id, updated_at DESC);
CREATE INDEX idx_execution_receipts_unprojected
  ON execution_receipts(projection_version, completed_at DESC);

ALTER TABLE work_intakes ADD COLUMN outcome_id TEXT;
ALTER TABLE goals ADD COLUMN outcome_id TEXT;
ALTER TABLE goals ADD COLUMN outcome_contract_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE execution_receipts ADD COLUMN outcome_id TEXT;
ALTER TABLE execution_receipts ADD COLUMN contract_version INTEGER;
ALTER TABLE execution_receipts ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE execution_receipts ADD COLUMN strategy TEXT;

CREATE INDEX idx_execution_receipts_outcome_started
  ON execution_receipts(outcome_id, started_at DESC);

CREATE UNIQUE INDEX idx_goals_outcome
  ON goals(outcome_id)
  WHERE outcome_id IS NOT NULL;

INSERT INTO outcomes (
  outcome_id, objective, user_status, internal_status, importance,
  latest_contract_version, created_at, updated_at
)
SELECT
  'outcome-goal-' || goals.goal_id,
  COALESCE(goal_contracts.objective, goals.title),
  CASE
    WHEN goals.status IN ('done', 'archived') THEN 'completed'
    WHEN goals.status IN ('blocked', 'needs_input') THEN 'needs_user'
    ELSE 'running'
  END,
  CASE
    WHEN goals.status IN ('done', 'archived') THEN 'completed'
    WHEN goals.status = 'blocked' THEN 'blocked'
    WHEN goals.status = 'needs_input' THEN 'needs_user'
    WHEN goals.status = 'paused' THEN 'paused'
    ELSE 'running'
  END,
  'normal',
  COALESCE(goal_contracts.version, 1),
  goals.created_at,
  goals.updated_at
FROM goals
LEFT JOIN goal_contracts ON goal_contracts.goal_id = goals.goal_id;

INSERT INTO outcome_contracts (
  outcome_id, version, objective, deliverables_json, acceptance_criteria_json,
  constraints_json, approval_required_json, created_by, created_at
)
SELECT
  'outcome-goal-' || goals.goal_id,
  COALESCE(goal_contracts.version, 1),
  COALESCE(goal_contracts.objective, goals.title),
  json_array(COALESCE(goal_contracts.objective, goals.title)),
  COALESCE((
    SELECT json_group_array(goal_checklist_items.text)
    FROM goal_checklist_items
    WHERE goal_checklist_items.goal_id = goals.goal_id
  ), '[]'),
  CASE
    WHEN goal_contracts.scope_boundary IS NULL THEN '[]'
    ELSE json_array(goal_contracts.scope_boundary)
  END,
  '[]',
  'system',
  goals.created_at
FROM goals
LEFT JOIN goal_contracts ON goal_contracts.goal_id = goals.goal_id;

UPDATE goals
SET outcome_id = 'outcome-goal-' || goal_id,
    outcome_contract_version = COALESCE((
      SELECT version FROM goal_contracts WHERE goal_contracts.goal_id = goals.goal_id
    ), 1);

INSERT INTO outcome_links (outcome_id, subject_kind, subject_id, relation, created_at)
SELECT outcome_id, 'project', project_id, 'contains', created_at
FROM goals WHERE project_id IS NOT NULL;

INSERT INTO outcome_links (outcome_id, subject_kind, subject_id, relation, created_at)
SELECT outcome_id, 'goal', goal_id, 'drives', created_at
FROM goals;

UPDATE work_intakes
SET outcome_id = (
  SELECT goals.outcome_id FROM goals WHERE goals.goal_id = work_intakes.goal_id
)
WHERE goal_id IS NOT NULL;

UPDATE execution_receipts
SET outcome_id = (
  SELECT goals.outcome_id FROM goals WHERE goals.goal_id = execution_receipts.goal_id
)
WHERE goal_id IS NOT NULL;

DROP TABLE goal_evidence_requirement_links;
DROP TABLE goal_evidence_requirements;
DROP TABLE goal_contracts;
