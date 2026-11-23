CREATE TABLE image_generation_jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  parent_id TEXT,
  version_number INTEGER NOT NULL,
  model_ref TEXT,
  request_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'saving', 'completed', 'failed')),
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  error_code TEXT,
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (work_id, version_number)
);
CREATE INDEX image_generation_due ON image_generation_jobs(next_attempt_at)
  WHERE state IN ('queued', 'running', 'saving');
CREATE INDEX image_generation_transcript ON image_generation_jobs(conversation_id, transcript_id, created_at DESC);
CREATE TABLE image_generation_daily_usage (
  day INTEGER PRIMARY KEY,
  count INTEGER NOT NULL
);
