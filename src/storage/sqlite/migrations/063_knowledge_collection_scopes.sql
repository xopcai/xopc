ALTER TABLE knowledge_source_items ADD COLUMN collection_scope TEXT NOT NULL DEFAULT 'primary';

DROP TABLE knowledge_source_state;

CREATE TABLE knowledge_collection_state (
  source_instance_id TEXT NOT NULL,
  collection_scope   TEXT NOT NULL,
  cursor             TEXT,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY(source_instance_id, collection_scope)
);

CREATE INDEX idx_knowledge_source_items_collection
  ON knowledge_source_items(source_instance_id, collection_scope, updated_at DESC);
