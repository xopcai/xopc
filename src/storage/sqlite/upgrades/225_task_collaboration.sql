CREATE TABLE task_collaboration_entries (
  entry_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  task_run_id TEXT REFERENCES task_runs(run_id) ON DELETE SET NULL,
  assignment_epoch INTEGER,
  sequence INTEGER NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('main_agent', 'worker_agent', 'user', 'system')),
  author_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'question', 'answer', 'instruction', 'ack', 'result', 'failure')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  causation_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, sequence),
  UNIQUE (task_id, idempotency_key)
);

CREATE INDEX idx_task_collaboration_task_sequence
  ON task_collaboration_entries(task_id, sequence);

CREATE TABLE task_collaboration_deliveries (
  entry_id TEXT PRIMARY KEY REFERENCES task_collaboration_entries(entry_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'confirmed', 'stale')),
  conversation_id TEXT,
  assignment_epoch INTEGER,
  client_message_id TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_task_collaboration_deliveries_pending
  ON task_collaboration_deliveries(status, updated_at);
