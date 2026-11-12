CREATE TABLE music_generation_jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  parent_id TEXT,
  version_number INTEGER NOT NULL,
  model_ref TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('song', 'instrumental')),
  prompt TEXT NOT NULL,
  lyrics TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued', 'submitting', 'submitted', 'running', 'saving', 'completed', 'failed', 'submission_unknown')),
  provider_task_id TEXT,
  duration_ms INTEGER,
  error TEXT,
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (work_id, version_number)
);
CREATE INDEX music_generation_due ON music_generation_jobs(next_attempt_at)
  WHERE state IN ('queued', 'submitting', 'submitted', 'running', 'saving');
CREATE INDEX music_generation_transcript ON music_generation_jobs(conversation_id, transcript_id, created_at DESC);
CREATE TABLE music_generation_daily_usage (
  day INTEGER PRIMARY KEY,
  count INTEGER NOT NULL
);
