CREATE TABLE discussion_recording_chunks (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  PRIMARY KEY(discussion_id, sequence)
);
