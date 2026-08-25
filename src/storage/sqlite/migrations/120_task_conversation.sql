ALTER TABLE task_sessions ADD COLUMN agent_id TEXT;
ALTER TABLE task_sessions ADD COLUMN run_id TEXT;
ALTER TABLE task_sessions ADD COLUMN assignment_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('active', 'completed', 'superseded', 'failed'));
ALTER TABLE task_sessions ADD COLUMN started_at INTEGER;
ALTER TABLE task_sessions ADD COLUMN ended_at INTEGER;

UPDATE task_sessions
SET agent_id = (
  SELECT sessions.agent_id FROM sessions WHERE sessions.session_key = task_sessions.session_key
), started_at = created_at;

UPDATE task_sessions
SET run_id = (
  SELECT task_runs.run_id
  FROM task_runs
  WHERE task_runs.task_id = task_sessions.task_id
    AND task_runs.session_key = task_sessions.session_key
  ORDER BY task_runs.queued_at DESC
  LIMIT 1
)
WHERE role = 'execution';

UPDATE task_sessions
SET status = 'superseded', ended_at = created_at
WHERE role = 'execution';

DELETE FROM task_sessions
WHERE role = 'execution'
  AND session_key IS NOT NULL
  AND task_session_id NOT IN (
    SELECT canonical.task_session_id
    FROM task_sessions AS canonical
    WHERE canonical.role = 'execution'
      AND canonical.session_key IS NOT NULL
      AND canonical.task_session_id = (
        SELECT candidate.task_session_id
        FROM task_sessions AS candidate
        WHERE candidate.role = 'execution'
          AND candidate.session_key = canonical.session_key
        ORDER BY candidate.created_at DESC, candidate.task_session_id DESC
        LIMIT 1
      )
  );

UPDATE task_sessions
SET status = 'active', ended_at = NULL, assignment_epoch = 1
WHERE task_session_id IN (
  SELECT latest.task_session_id FROM task_sessions AS latest
  WHERE latest.role = 'execution'
    AND latest.task_session_id = (
      SELECT candidate.task_session_id
      FROM task_sessions AS candidate
      WHERE candidate.task_id = latest.task_id AND candidate.role = 'execution'
      ORDER BY candidate.created_at DESC, candidate.task_session_id DESC
      LIMIT 1
    )
);

CREATE UNIQUE INDEX idx_task_sessions_active_execution
  ON task_sessions(task_id)
  WHERE role = 'execution' AND status = 'active';
CREATE UNIQUE INDEX idx_task_sessions_execution_owner
  ON task_sessions(session_key)
  WHERE role = 'execution' AND session_key IS NOT NULL;

CREATE TABLE task_conversation_state (
  task_id TEXT PRIMARY KEY,
  active_session_key TEXT,
  current_executor_agent_id TEXT,
  assignment_epoch INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'active')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (active_session_key) REFERENCES sessions(session_key) ON DELETE SET NULL
);

INSERT INTO task_conversation_state (
  task_id, active_session_key, current_executor_agent_id,
  assignment_epoch, status, updated_at
)
SELECT
  tasks.task_id,
  active.session_key,
  COALESCE(active.agent_id, tasks.delegate_agent_id, tasks.owner_id),
  COALESCE(active.assignment_epoch, 0),
  CASE WHEN active.session_key IS NULL THEN 'idle' ELSE 'active' END,
  tasks.updated_at
FROM tasks
LEFT JOIN task_sessions AS active
  ON active.task_id = tasks.task_id
  AND active.role = 'execution'
  AND active.status = 'active';

CREATE TABLE task_handoff_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_session_key TEXT,
  to_session_key TEXT NOT NULL,
  from_agent_id TEXT,
  to_agent_id TEXT NOT NULL,
  assignment_epoch INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(task_id) ON DELETE CASCADE,
  FOREIGN KEY (from_session_key) REFERENCES sessions(session_key) ON DELETE SET NULL,
  FOREIGN KEY (to_session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);
CREATE INDEX idx_task_handoffs_task
  ON task_handoff_snapshots(task_id, assignment_epoch DESC);
