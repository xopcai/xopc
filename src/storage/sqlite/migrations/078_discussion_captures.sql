CREATE TABLE IF NOT EXISTS discussion_captures (
  id                    TEXT PRIMARY KEY,
  client_request_id     TEXT NOT NULL UNIQUE,
  note_id               TEXT NOT NULL UNIQUE,
  project_id            TEXT,
  audio_attachment_id   TEXT,
  status                TEXT NOT NULL CHECK (status IN (
    'awaiting_upload',
    'queued',
    'transcribing',
    'analyzing',
    'review_required',
    'completed',
    'failed',
    'cancelled'
  )),
  failed_stage          TEXT,
  capture_mode          TEXT NOT NULL CHECK (capture_mode IN ('solo', 'conversation')),
  consent_confirmed     INTEGER NOT NULL DEFAULT 0,
  language_hint         TEXT,
  duration_ms           INTEGER,
  mime_type             TEXT,
  audio_size_bytes      INTEGER,
  audio_sha256          TEXT,
  transcript_raw        TEXT,
  transcript_sha256     TEXT,
  transcript_language   TEXT,
  stt_provider          TEXT,
  analysis_json         TEXT,
  analysis_version      INTEGER NOT NULL DEFAULT 0,
  analysis_input_hash   TEXT,
  analyzer_model_ref    TEXT,
  review_json           TEXT,
  review_revision       INTEGER NOT NULL DEFAULT 0,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at       INTEGER,
  lease_owner           TEXT,
  lease_expires_at      INTEGER,
  last_error_code       TEXT,
  last_error_message    TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  completed_at          INTEGER,
  reviewed_at           INTEGER,
  audio_deleted_at      INTEGER,
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_discussion_captures_queue
  ON discussion_captures(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_discussion_captures_project
  ON discussion_captures(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS discussion_action_conversions (
  discussion_id TEXT NOT NULL,
  action_id      TEXT NOT NULL,
  work_item_id   TEXT NOT NULL UNIQUE,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, action_id),
  FOREIGN KEY (discussion_id) REFERENCES discussion_captures(id) ON DELETE CASCADE,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

