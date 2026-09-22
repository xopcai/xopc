CREATE TABLE note_file_cleanup (
  note_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (note_id, relative_path)
);
