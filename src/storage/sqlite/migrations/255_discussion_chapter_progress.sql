CREATE TABLE discussion_chapter_progress (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  source_sha256 TEXT NOT NULL,
  transcript_revision INTEGER NOT NULL,
  transcript_sha256 TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  position INTEGER NOT NULL,
  chapter_json TEXT NOT NULL,
  PRIMARY KEY(discussion_id, source_sha256, transcript_revision, transcript_sha256, input_hash)
);
