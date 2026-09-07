ALTER TABLE knowledge_items
  ADD COLUMN record_class TEXT NOT NULL DEFAULT 'memory'
  CHECK(record_class IN ('memory', 'source_index'));

UPDATE knowledge_items
SET record_class = 'source_index'
WHERE canonical_key LIKE 'source-item:%';

DELETE FROM knowledge_items_fts
WHERE knowledge_id IN (
  SELECT knowledge_id FROM knowledge_items WHERE canonical_key LIKE 'source-day:%'
);

DELETE FROM knowledge_items
WHERE canonical_key LIKE 'source-day:%';

CREATE INDEX idx_knowledge_items_class_status
  ON knowledge_items(principal_id, record_class, status, updated_at DESC);
