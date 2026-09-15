CREATE TABLE discussion_recording_jobs (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL UNIQUE REFERENCES discussion_captures(id) ON DELETE CASCADE,
  input_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  lease_owner TEXT,
  lease_until INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX discussion_recording_jobs_pending ON discussion_recording_jobs(state, created_at);
