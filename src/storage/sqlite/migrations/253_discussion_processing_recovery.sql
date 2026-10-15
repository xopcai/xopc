CREATE TABLE discussion_processing (
  discussion_id TEXT PRIMARY KEY REFERENCES discussion_captures(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL UNIQUE,
  audio_sha256 TEXT,
  base_transcript_revision INTEGER NOT NULL,
  force_audio INTEGER NOT NULL DEFAULT 0 CHECK(force_audio IN (0,1)),
  retry_stage TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_owner TEXT,
  lease_until INTEGER
);
CREATE TABLE discussion_transcription_checkpoints (
  run_id TEXT NOT NULL REFERENCES discussion_processing(run_id) ON DELETE CASCADE,
  started_at_ms REAL NOT NULL,
  ended_at_ms REAL NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, started_at_ms, ended_at_ms)
);
