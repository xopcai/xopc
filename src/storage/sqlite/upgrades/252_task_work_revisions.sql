CREATE TABLE task_work_revisions (
  revision_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  contract_version INTEGER NOT NULL,
  baseline_delivery_id TEXT NOT NULL,
  baseline_version TEXT NOT NULL,
  instruction_entry_id TEXT NOT NULL,
  input_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  supersedes_json TEXT NOT NULL DEFAULT '[]',
  original_body TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id, contract_version)
);
