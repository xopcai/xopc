CREATE TABLE IF NOT EXISTS task_criterion_reviews (
  task_id TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  criterion_index INTEGER NOT NULL,
  criterion_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  note TEXT,
  reviewed_by_json TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, contract_version, criterion_index),
  FOREIGN KEY (task_id, contract_version) REFERENCES task_contracts(task_id, version) ON DELETE CASCADE
);
