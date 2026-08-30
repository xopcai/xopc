ALTER TABLE context_evidence ADD COLUMN source_run_id TEXT;
ALTER TABLE context_evidence ADD COLUMN source_item_id TEXT;
ALTER TABLE context_evidence ADD COLUMN session_id TEXT;
ALTER TABLE context_evidence ADD COLUMN turn_id TEXT;
ALTER TABLE context_evidence ADD COLUMN message_id TEXT;
ALTER TABLE context_evidence ADD COLUMN content_hash TEXT;
ALTER TABLE context_evidence ADD COLUMN retention_policy TEXT;
ALTER TABLE context_evidence ADD COLUMN processing_policy TEXT;
ALTER TABLE context_evidence ADD COLUMN extractor_id TEXT;
ALTER TABLE context_evidence ADD COLUMN extractor_version TEXT;
ALTER TABLE context_evidence ADD COLUMN ingested_at INTEGER;

UPDATE context_evidence SET ingested_at = created_at WHERE ingested_at IS NULL;

CREATE INDEX idx_context_evidence_run
  ON context_evidence(source_run_id, observed_at DESC);
CREATE INDEX idx_context_evidence_message
  ON context_evidence(session_id, turn_id, message_id);
