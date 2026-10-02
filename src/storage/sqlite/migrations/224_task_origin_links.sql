CREATE TABLE IF NOT EXISTS task_origin_links (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_origin_links_conversation
  ON task_origin_links(conversation_id, created_at DESC);
