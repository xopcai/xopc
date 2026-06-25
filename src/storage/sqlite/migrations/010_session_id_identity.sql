ALTER TABLE sessions RENAME COLUMN current_transcript_id TO session_id;

ALTER TABLE transcripts RENAME COLUMN transcript_id TO session_id;

DROP INDEX IF EXISTS idx_transcripts_session;
CREATE INDEX IF NOT EXISTS idx_transcripts_session
  ON transcripts(session_key, status);

ALTER TABLE transcript_entries RENAME COLUMN transcript_id TO session_id;

DROP INDEX IF EXISTS idx_entries_transcript_seq;
DROP INDEX IF EXISTS idx_entries_kind;
CREATE INDEX IF NOT EXISTS idx_entries_session_seq
  ON transcript_entries(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_entries_kind
  ON transcript_entries(session_id, entry_kind);

ALTER TABLE compaction_checkpoints RENAME COLUMN transcript_id TO session_id;

ALTER TABLE transcript_fts RENAME TO transcript_fts_legacy;
CREATE VIRTUAL TABLE transcript_fts USING fts5(
  content,
  session_key UNINDEXED,
  session_id UNINDEXED,
  entry_id UNINDEXED,
  tokenize='unicode61'
);
INSERT INTO transcript_fts (content, session_key, session_id, entry_id)
  SELECT content, session_key, transcript_id, entry_id FROM transcript_fts_legacy;
DROP TABLE transcript_fts_legacy;
