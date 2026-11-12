CREATE TABLE video_generation_jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES transcripts(transcript_id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  prompt TEXT NOT NULL,
  duration INTEGER NOT NULL,
  ratio TEXT NOT NULL,
  resolution TEXT NOT NULL,
  image_name TEXT,
  image_mime TEXT,
  image_bytes BLOB,
  state TEXT NOT NULL CHECK (state IN ('queued','submitting','submitted','running','saving','completed','failed','submission_unknown')),
  provider_task_id TEXT,
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX video_generation_due ON video_generation_jobs(next_attempt_at)
  WHERE state IN ('queued','submitting','submitted','running','saving');
CREATE INDEX video_generation_conversation ON video_generation_jobs(conversation_id, created_at DESC);

CREATE TABLE video_generation_budget (
  day INTEGER PRIMARY KEY,
  reserved_fen INTEGER NOT NULL
);
