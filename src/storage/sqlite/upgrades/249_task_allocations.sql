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
CREATE INDEX task_allocations_pending ON task_allocations(status, next_attempt_at, lease_expires_at);
