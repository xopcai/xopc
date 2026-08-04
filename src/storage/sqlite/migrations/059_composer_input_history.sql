CREATE TABLE composer_input_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_composer_input_history_recent
  ON composer_input_history(id DESC);
