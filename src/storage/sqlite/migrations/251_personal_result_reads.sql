CREATE TABLE personal_result_documents (
  document_id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES task_result_deliveries(delivery_id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'ready', 'unsupported', 'failed')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  parser_version INTEGER NOT NULL,
  content_revision TEXT,
  content TEXT,
  sections_json TEXT NOT NULL DEFAULT '[]',
  limitations_json TEXT NOT NULL DEFAULT '[]',
  fingerprint TEXT,
  error TEXT,
  UNIQUE(delivery_id, source_id)
);
CREATE VIRTUAL TABLE personal_result_search USING fts5(
  document_id UNINDEXED, start_offset UNINDEXED, text, tokenize='trigram'
);
CREATE TABLE personal_result_sections (
  document_id TEXT NOT NULL REFERENCES personal_result_documents(document_id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  char_length INTEGER NOT NULL,
  locator_json TEXT NOT NULL,
  PRIMARY KEY(document_id, section_id)
);
CREATE INDEX idx_personal_result_sections_order ON personal_result_sections(document_id, ordinal);
CREATE TABLE personal_result_read_waits (
  input_id TEXT PRIMARY KEY REFERENCES session_inputs(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  requests_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','queued','done','stale'))
);
CREATE TRIGGER personal_result_documents_delete AFTER DELETE ON personal_result_documents BEGIN
  DELETE FROM personal_result_search WHERE document_id = old.document_id;
END;
