CREATE TABLE work_item_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO work_item_migration_guard (valid)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM work_items
WHERE status NOT IN (
  'backlog', 'todo', 'in_progress', 'blocked',
  'needs_input', 'in_review', 'done', 'cancelled'
);

DROP TABLE work_item_migration_guard;

ALTER TABLE work_items RENAME TO work_items_before_lifecycle;

CREATE TABLE work_items (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  priority              TEXT NOT NULL DEFAULT 'normal',
  owner_agent_id        TEXT,
  phase                 TEXT NOT NULL,
  completion_policy     TEXT NOT NULL DEFAULT 'agent_verified',
  next_action_text      TEXT,
  next_action_actor     TEXT,
  next_action_due_at    INTEGER,
  resolution            TEXT,
  resolution_reason     TEXT,
  due_at                INTEGER,
  started_at            INTEGER,
  review_requested_at   INTEGER,
  closed_at             INTEGER,
  archived_at           INTEGER,
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,

  CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  CHECK (phase IN ('backlog', 'ready', 'executing', 'verifying', 'closed')),
  CHECK (completion_policy IN ('automatic', 'agent_verified', 'user_accepted')),
  CHECK (next_action_actor IS NULL OR next_action_actor IN ('agent', 'user', 'external', 'system')),
  CHECK (resolution IS NULL OR resolution IN ('completed', 'cancelled', 'duplicate', 'superseded', 'expired', 'not_feasible')),
  CHECK (
    (phase = 'closed' AND resolution IS NOT NULL AND closed_at IS NOT NULL)
    OR (phase <> 'closed' AND resolution IS NULL AND closed_at IS NULL)
  ),
  CHECK (
    (next_action_text IS NULL AND next_action_actor IS NULL AND next_action_due_at IS NULL)
    OR (next_action_text IS NOT NULL AND next_action_actor IS NOT NULL)
  )
);

INSERT INTO work_items (
  id, project_id, title, description, priority, owner_agent_id, phase, completion_policy,
  next_action_text, next_action_actor, resolution, due_at, closed_at, archived_at,
  version, created_at, updated_at
)
SELECT
  id,
  project_id,
  title,
  description,
  priority,
  owner_agent_id,
  CASE status
    WHEN 'backlog' THEN 'backlog'
    WHEN 'todo' THEN 'ready'
    WHEN 'in_progress' THEN 'executing'
    WHEN 'blocked' THEN 'executing'
    WHEN 'needs_input' THEN 'executing'
    WHEN 'in_review' THEN 'verifying'
    WHEN 'done' THEN 'closed'
    WHEN 'cancelled' THEN 'closed'
  END,
  CASE WHEN status = 'in_review' THEN 'user_accepted' ELSE 'agent_verified' END,
  next_action,
  CASE
    WHEN next_action IS NULL THEN NULL
    WHEN status IN ('needs_input', 'in_review') THEN 'user'
    ELSE 'agent'
  END,
  CASE status WHEN 'done' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE NULL END,
  due_at,
  CASE
    WHEN status IN ('done', 'cancelled') THEN COALESCE(completed_at, updated_at)
    ELSE NULL
  END,
  archived_at,
  1,
  created_at,
  updated_at
FROM work_items_before_lifecycle;

CREATE TABLE work_item_waits (
  id                     TEXT PRIMARY KEY,
  work_item_id           TEXT NOT NULL,
  kind                   TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  resume_at              INTEGER,
  blocking_work_item_id  TEXT,
  created_at             INTEGER NOT NULL,
  resolved_at            INTEGER,
  resolution_note        TEXT,

  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (blocking_work_item_id) REFERENCES work_items(id),
  CHECK (kind IN ('user_input', 'user_approval', 'dependency', 'external', 'scheduled', 'retry', 'paused')),
  CHECK (
    (kind = 'dependency' AND blocking_work_item_id IS NOT NULL)
    OR (kind <> 'dependency' AND blocking_work_item_id IS NULL)
  ),
  CHECK (kind IN ('scheduled', 'retry') OR resume_at IS NULL)
);

INSERT INTO work_item_waits (id, work_item_id, kind, reason, created_at)
SELECT
  'migration:' || id || ':wait',
  id,
  CASE status
    WHEN 'blocked' THEN 'external'
    WHEN 'needs_input' THEN 'user_input'
    WHEN 'in_review' THEN 'user_approval'
  END,
  COALESCE(blocked_reason, next_action, 'Waiting for the next required action.'),
  updated_at
FROM work_items_before_lifecycle
WHERE status IN ('blocked', 'needs_input', 'in_review');

DROP TABLE work_items_before_lifecycle;
DROP INDEX IF EXISTS idx_work_items_project_status;

CREATE INDEX idx_work_items_project_phase
  ON work_items(project_id, phase, archived_at, updated_at DESC);

CREATE INDEX idx_work_items_due
  ON work_items(due_at)
  WHERE archived_at IS NULL AND phase <> 'closed';

CREATE INDEX idx_work_item_waits_open
  ON work_item_waits(work_item_id, kind)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_work_item_waits_resume
  ON work_item_waits(resume_at)
  WHERE resolved_at IS NULL AND resume_at IS NOT NULL;

CREATE INDEX idx_work_item_waits_blocker
  ON work_item_waits(blocking_work_item_id)
  WHERE resolved_at IS NULL;

DROP TABLE work_item_update_suggestions;

CREATE TABLE work_item_command_proposals (
  id                TEXT PRIMARY KEY,
  work_item_id      TEXT NOT NULL,
  command_json      TEXT NOT NULL,
  source_kind       TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  rationale         TEXT,
  confidence        REAL,
  state             TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  resolved_at       INTEGER,

  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  CHECK (source_kind IN ('chat', 'workflow_run', 'automation')),
  CHECK (state IN ('pending', 'executed', 'rejected', 'expired')),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX idx_work_item_command_proposals_item
  ON work_item_command_proposals(work_item_id, state, created_at DESC);

DELETE FROM work_item_events;

INSERT INTO work_item_events (id, work_item_id, type, payload_json, created_at)
SELECT
  'migration:' || id || ':created',
  id,
  'work_item.created',
  json_object('phase', phase, 'priority', priority),
  updated_at
FROM work_items;

UPDATE proactive_scenarios
SET event_types_json = '["project.updated.v1","work_item.lifecycle_changed.v1","work_item.updated.v1"]'
WHERE scenario_key = 'project_delivery_risk';

UPDATE proactive_scenarios
SET event_types_json = '["work_item.lifecycle_changed.v1","work_item.updated.v1"]',
    condition_json = '{"op":"eq","field":"payload.command","value":"wait"}'
WHERE scenario_key = 'blocked_work';
