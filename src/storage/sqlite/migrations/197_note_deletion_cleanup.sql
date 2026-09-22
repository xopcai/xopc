CREATE TABLE note_deletion_cleanup (
  kind TEXT NOT NULL CHECK(kind IN ('media', 'share')),
  object_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(kind, object_id)
);
