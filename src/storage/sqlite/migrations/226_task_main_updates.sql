CREATE TABLE task_main_update_deliveries (
  entry_id TEXT PRIMARY KEY REFERENCES task_collaboration_entries(entry_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered')),
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_task_main_update_deliveries_pending
  ON task_main_update_deliveries(status, updated_at);
