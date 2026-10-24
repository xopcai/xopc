ALTER TABLE knowledge_items ADD COLUMN claim_mode TEXT NOT NULL DEFAULT 'observed'
  CHECK (claim_mode IN ('explicit', 'observed', 'inferred', 'reported'));
ALTER TABLE knowledge_items ADD COLUMN verification TEXT NOT NULL DEFAULT 'supported'
  CHECK (verification IN ('supported', 'tentative', 'conflicted'));
ALTER TABLE knowledge_items ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal'
  CHECK (sensitivity IN ('normal', 'personal', 'secret', 'regulated'));
ALTER TABLE user_assertion_evidence ADD COLUMN content_hash TEXT;
CREATE TRIGGER assertion_evidence_snapshot_insert AFTER INSERT ON user_assertion_evidence BEGIN
  UPDATE user_assertion_evidence SET content_hash = (SELECT content_hash FROM context_evidence WHERE evidence_id = NEW.evidence_id)
    WHERE assertion_id = NEW.assertion_id AND evidence_id = NEW.evidence_id AND relation = NEW.relation;
END;
CREATE TRIGGER assertion_evidence_snapshot_update AFTER UPDATE OF confidence ON user_assertion_evidence BEGIN
  UPDATE user_assertion_evidence SET content_hash = (SELECT content_hash FROM context_evidence WHERE evidence_id = NEW.evidence_id)
    WHERE assertion_id = NEW.assertion_id AND evidence_id = NEW.evidence_id AND relation = NEW.relation;
END;
UPDATE knowledge_items SET claim_mode = CASE origin_class
  WHEN 'owner' THEN 'explicit' WHEN 'untrusted' THEN 'reported' ELSE 'observed' END,
  verification = CASE WHEN origin_class = 'untrusted' AND record_class = 'memory' THEN 'tentative' ELSE 'supported' END;

CREATE TABLE knowledge_revisions (
  revision_id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  source_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX knowledge_revisions_item ON knowledge_revisions(knowledge_id, created_at);
CREATE TABLE knowledge_evidence_links (
  knowledge_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES context_evidence(evidence_id) ON DELETE CASCADE,
  content_hash TEXT,
  consent_receipt_id TEXT REFERENCES understanding_consent_receipts(receipt_id),
  PRIMARY KEY (knowledge_id, evidence_id)
);
CREATE TABLE owner_identity_bindings (
  principal_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (channel, account_id, peer_id)
);
CREATE TABLE memory_learning_jobs (
  job_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL DEFAULT 'local-owner',
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  through_seq INTEGER NOT NULL,
  start_seq INTEGER,
  extractor_version TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','retry_wait','failed','canceled')),
  lease_token TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id, transcript_id, through_seq, extractor_version, policy_hash)
);
CREATE INDEX memory_learning_jobs_due ON memory_learning_jobs(state, next_attempt_at, lease_until);
CREATE TABLE memory_source_learning_jobs (
  job_id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL REFERENCES knowledge_source_chunks(chunk_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  consent_receipt_id TEXT NOT NULL REFERENCES understanding_consent_receipts(receipt_id),
  policy_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','retry_wait','failed','canceled')),
  lease_token TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(chunk_id, agent_id, consent_receipt_id, policy_hash)
);
CREATE INDEX memory_source_learning_due ON memory_source_learning_jobs(state, next_attempt_at, lease_until);
CREATE TABLE memory_learning_receipts (
  run_id TEXT PRIMARY KEY REFERENCES task_run_receipts(run_id) ON DELETE CASCADE,
  learned_at INTEGER NOT NULL,
  knowledge_id TEXT
);
CREATE TABLE memory_learning_cursors (
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  processed_seq INTEGER NOT NULL DEFAULT 0,
  observed_seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, transcript_id)
);
CREATE TABLE knowledge_source_chunks (
  chunk_id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE,
  source_version TEXT NOT NULL,
  consent_receipt_id TEXT REFERENCES understanding_consent_receipts(receipt_id),
  ordinal INTEGER NOT NULL,
  locator TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE(source_item_id, ordinal)
);
CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(search_text, chunk_id UNINDEXED, tokenize='unicode61');
CREATE TRIGGER knowledge_chunk_insert AFTER INSERT ON knowledge_source_chunks BEGIN
  INSERT INTO knowledge_chunks_fts(search_text, chunk_id) VALUES (xopc_memory_search_text(NEW.text), NEW.chunk_id);
END;
CREATE TRIGGER knowledge_chunk_delete AFTER DELETE ON knowledge_source_chunks BEGIN
  DELETE FROM knowledge_chunks_fts WHERE chunk_id = OLD.chunk_id;
END;
CREATE VIRTUAL TABLE knowledge_search_fts USING fts5(search_text, knowledge_id UNINDEXED, tokenize='unicode61');
INSERT INTO knowledge_search_fts SELECT xopc_memory_search_text(content), knowledge_id FROM knowledge_items;
DROP TABLE knowledge_items_fts;
CREATE TRIGGER knowledge_search_insert AFTER INSERT ON knowledge_items BEGIN
  INSERT INTO knowledge_search_fts VALUES (xopc_memory_search_text(NEW.content), NEW.knowledge_id);
END;
CREATE TRIGGER knowledge_search_update AFTER UPDATE OF content ON knowledge_items BEGIN
  DELETE FROM knowledge_search_fts WHERE knowledge_id = OLD.knowledge_id;
  INSERT INTO knowledge_search_fts VALUES (xopc_memory_search_text(NEW.content), NEW.knowledge_id);
END;
CREATE TRIGGER knowledge_search_delete AFTER DELETE ON knowledge_items BEGIN
  DELETE FROM knowledge_search_fts WHERE knowledge_id = OLD.knowledge_id;
END;
