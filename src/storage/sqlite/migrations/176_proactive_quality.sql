ALTER TABLE knowledge_sync_runs ADD COLUMN collection_scope TEXT;
ALTER TABLE proactive_presence ADD COLUMN inbox_item_id TEXT;
ALTER TABLE proactive_presence ADD COLUMN notification_revision INTEGER;
ALTER TABLE proactive_inbox_items ADD COLUMN actionable_until TEXT;
CREATE INDEX knowledge_sync_source_scope ON knowledge_sync_runs(source_instance_id, collection_scope, started_at DESC);
