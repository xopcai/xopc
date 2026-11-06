ALTER TABLE task_criterion_reviews RENAME TO task_criterion_reviews_v270;

CREATE TABLE task_criterion_reviews (
  task_id TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  criterion_index INTEGER NOT NULL,
  criterion_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'unverified')),
  note TEXT,
  reviewed_by_json TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, contract_version, criterion_index),
  FOREIGN KEY (task_id, contract_version) REFERENCES task_contracts(task_id, version) ON DELETE CASCADE
);

INSERT INTO task_criterion_reviews
  (task_id, contract_version, criterion_index, criterion_text, status, note, reviewed_by_json, reviewed_at)
SELECT task_id, contract_version, criterion_index, criterion_text, status, note, reviewed_by_json, reviewed_at
FROM task_criterion_reviews_v270;

DROP TABLE task_criterion_reviews_v270;
