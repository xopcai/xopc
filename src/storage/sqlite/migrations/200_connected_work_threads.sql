ALTER TABLE knowledge_item_status_events RENAME TO knowledge_item_status_events_v199;
ALTER TABLE knowledge_items RENAME TO knowledge_items_v199;

CREATE TABLE knowledge_items (
  knowledge_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'work_thread', 'project_fact', 'workspace_fact', 'decision', 'task_lesson',
    'commitment', 'open_question', 'episode', 'note'
  )),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'agent', 'workspace', 'project', 'session')),
  scope_id TEXT,
  content TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL CHECK(importance >= 0 AND importance <= 1),
  valid_from INTEGER,
  valid_to INTEGER,
  expires_at INTEGER,
  review_at INTEGER,
  origin_class TEXT NOT NULL CHECK(origin_class IN ('owner', 'agent', 'system', 'untrusted')),
  source_agent_id TEXT,
  source_conversation_id TEXT,
  source_turn_id TEXT,
  derived_from_recalled_context INTEGER NOT NULL DEFAULT 0 CHECK(derived_from_recalled_context IN (0, 1)),
  source_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  record_class TEXT NOT NULL DEFAULT 'memory' CHECK(record_class IN ('memory', 'source_index')),
  CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

INSERT INTO knowledge_items (
  knowledge_id, principal_id, kind, scope_type, scope_id, content, canonical_key,
  status, confidence, importance, valid_from, valid_to, expires_at, review_at,
  origin_class, source_agent_id, source_conversation_id, source_turn_id,
  derived_from_recalled_context, source_json, created_at, updated_at, record_class
)
SELECT
  knowledge_id,
  principal_id,
  CASE
    WHEN record_class = 'memory' AND canonical_key LIKE 'connected-thread:%'
      THEN 'work_thread'
    ELSE kind
  END,
  CASE
    WHEN record_class = 'memory' AND canonical_key LIKE 'connected-thread:%'
      THEN 'global'
    ELSE scope_type
  END,
  CASE
    WHEN record_class = 'memory' AND canonical_key LIKE 'connected-thread:%'
      THEN NULL
    ELSE scope_id
  END,
  content, canonical_key, status, confidence, importance, valid_from, valid_to,
  expires_at, review_at, origin_class, source_agent_id, source_conversation_id,
  source_turn_id, derived_from_recalled_context, source_json, created_at, updated_at,
  record_class
FROM knowledge_items_v199;

CREATE TABLE knowledge_item_status_events (
  event_id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user', 'agent', 'runtime', 'maintenance', 'migration')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO knowledge_item_status_events
SELECT * FROM knowledge_item_status_events_v199;

DROP TABLE knowledge_item_status_events_v199;
DROP TABLE knowledge_items_v199;

CREATE INDEX idx_knowledge_items_status
  ON knowledge_items(principal_id, status, updated_at DESC);
CREATE INDEX idx_knowledge_items_scope
  ON knowledge_items(principal_id, scope_type, scope_id, status);
CREATE INDEX idx_knowledge_items_lifecycle
  ON knowledge_items(status, expires_at, review_at);
CREATE INDEX idx_knowledge_items_class_status
  ON knowledge_items(principal_id, record_class, status, updated_at DESC);
CREATE UNIQUE INDEX idx_knowledge_items_canonical
  ON knowledge_items(principal_id, canonical_key, scope_type, COALESCE(scope_id, ''))
  WHERE status IN ('candidate', 'active', 'needs_review', 'stale');
CREATE INDEX idx_knowledge_item_status_events_item
  ON knowledge_item_status_events(knowledge_id, created_at DESC);
