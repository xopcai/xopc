-- Keep unscoped legacy entries out of session recall.
ALTER TABLE composer_input_history RENAME TO composer_input_history_legacy;
DROP INDEX idx_composer_input_history_recent;
CREATE TABLE composer_input_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_composer_input_history_recent
  ON composer_input_history(conversation_id, id DESC);
