CREATE TABLE IF NOT EXISTS knowledge_item_status_events (
  event_id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'agent', 'runtime', 'maintenance', 'migration')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_item_status_events_item
  ON knowledge_item_status_events(knowledge_id, created_at DESC);
