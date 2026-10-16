CREATE TABLE task_main_update_deliveries_new (
  entry_id TEXT PRIMARY KEY REFERENCES task_collaboration_entries(entry_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  updated_at INTEGER NOT NULL,
  decision TEXT CHECK (decision IN ('notify', 'silent')),
  decision_reason TEXT,
  decided_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

INSERT INTO task_main_update_deliveries_new
  (entry_id, conversation_id, status, updated_at, decision, decision_reason, decided_at)
SELECT entry_id, conversation_id, status, updated_at, decision, decision_reason, decided_at
FROM task_main_update_deliveries;

DROP TABLE task_main_update_deliveries;
ALTER TABLE task_main_update_deliveries_new RENAME TO task_main_update_deliveries;
CREATE INDEX idx_task_main_update_deliveries_pending
  ON task_main_update_deliveries(status, updated_at);
