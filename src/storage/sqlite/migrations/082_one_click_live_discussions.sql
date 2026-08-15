DROP TABLE IF EXISTS discussion_action_conversions;
DROP TABLE IF EXISTS discussion_transcript_segments;
DROP TABLE IF EXISTS discussion_capture_settings;
DROP TABLE IF EXISTS discussion_captures;

CREATE TABLE discussion_captures (
  id                         TEXT PRIMARY KEY,
  client_request_id          TEXT NOT NULL UNIQUE,
  note_id                    TEXT NOT NULL UNIQUE,
  project_id                 TEXT,
  audio_attachment_id        TEXT,
  source                     TEXT NOT NULL CHECK (source IN ('web', 'electron')),
  status                     TEXT NOT NULL CHECK (status IN (
    'recording',
    'finalizing',
    'completed',
    'failed',
    'cancelled'
  )),
  processing_stage           TEXT CHECK (processing_stage IN (
    'original_upload',
    'final_transcription',
    'analysis',
    'note_write'
  )),
  duration_ms                INTEGER,
  expected_last_sequence     INTEGER,
  mime_type                  TEXT,
  audio_size_bytes           INTEGER,
  audio_sha256               TEXT,
  transcript_raw             TEXT,
  transcript_sha256          TEXT,
  transcript_language        TEXT,
  stt_provider               TEXT,
  analysis_json              TEXT,
  analysis_input_hash        TEXT,
  analyzer_model_ref         TEXT,
  generated_title            TEXT,
  project_inference_score    REAL,
  project_inference_source   TEXT,
  finalization_revision      INTEGER NOT NULL DEFAULT 0,
  attempt_count              INTEGER NOT NULL DEFAULT 0,
  next_attempt_at            INTEGER,
  lease_owner                TEXT,
  lease_expires_at           INTEGER,
  last_error_code            TEXT,
  last_error_message         TEXT,
  recording_started_at       INTEGER NOT NULL,
  recording_finished_at      INTEGER,
  created_at                 INTEGER NOT NULL,
  updated_at                 INTEGER NOT NULL,
  completed_at               INTEGER,
  audio_deleted_at           INTEGER,
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

CREATE INDEX idx_discussion_captures_queue
  ON discussion_captures(status, next_attempt_at, created_at);

CREATE INDEX idx_discussion_captures_project
  ON discussion_captures(project_id, updated_at DESC);

CREATE TABLE discussion_transcript_segments (
  discussion_id    TEXT NOT NULL,
  sequence         INTEGER NOT NULL,
  audio_sha256     TEXT NOT NULL,
  audio_blob       BLOB,
  started_at_ms    INTEGER NOT NULL,
  ended_at_ms      INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('uploaded', 'transcribing', 'completed', 'failed')),
  transcript       TEXT,
  provider         TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER,
  lease_owner      TEXT,
  lease_expires_at INTEGER,
  last_error       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, sequence),
  FOREIGN KEY (discussion_id) REFERENCES discussion_captures(id) ON DELETE CASCADE
);

CREATE INDEX idx_discussion_segments_queue
  ON discussion_transcript_segments(status, next_attempt_at, created_at);

CREATE TABLE discussion_capture_settings (
  workspace_id               TEXT PRIMARY KEY,
  consent_policy_version     INTEGER NOT NULL,
  consent_acknowledged_at    INTEGER,
  updated_at                 INTEGER NOT NULL
);

INSERT INTO discussion_capture_settings (
  workspace_id,
  consent_policy_version,
  consent_acknowledged_at,
  updated_at
) VALUES ('default', 1, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER));
