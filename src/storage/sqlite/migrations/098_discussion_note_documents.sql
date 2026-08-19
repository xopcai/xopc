DROP TABLE IF EXISTS discussion_organizations;
DROP TABLE IF EXISTS discussion_transcript_segments;
DROP TABLE IF EXISTS discussion_captures;

CREATE TABLE discussion_captures (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  note_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  audio_attachment_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('web', 'electron')),
  status TEXT NOT NULL CHECK (status IN (
    'recording', 'stopping', 'sealing', 'organizing',
    'completed', 'needs_attention', 'cancelled'
  )),
  duration_ms INTEGER,
  expected_last_sequence INTEGER,
  mime_type TEXT,
  audio_size_bytes INTEGER,
  audio_sha256 TEXT,
  canonical_transcript TEXT,
  canonical_transcript_sha256 TEXT,
  transcript_language TEXT,
  transcript_revision INTEGER NOT NULL DEFAULT 0,
  generated_title TEXT,
  project_inference_score REAL,
  project_inference_source TEXT,
  failure_stage TEXT CHECK (failure_stage IN (
    'segment_upload', 'segment_transcription', 'audio_upload',
    'transcript_sealing', 'organization'
  )),
  failure_code TEXT,
  failure_message TEXT,
  work_lease_owner TEXT,
  work_lease_expires_at INTEGER,
  recording_started_at INTEGER NOT NULL,
  recording_stopped_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  audio_deleted_at INTEGER,
  FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

CREATE INDEX idx_discussion_captures_queue
  ON discussion_captures(status, work_lease_expires_at, updated_at);
CREATE INDEX idx_discussion_captures_project
  ON discussion_captures(project_id, updated_at DESC);

CREATE TABLE discussion_transcript_segments (
  discussion_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  audio_sha256 TEXT NOT NULL,
  audio_blob BLOB,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'transcribing', 'confirmed', 'failed')),
  raw_text TEXT,
  display_text TEXT,
  language TEXT,
  provider TEXT,
  confidence REAL,
  speaker_label TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  corrected_by_user INTEGER NOT NULL DEFAULT 0,
  corrected_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, sequence),
  FOREIGN KEY (discussion_id) REFERENCES discussion_captures(id) ON DELETE CASCADE
);

CREATE INDEX idx_discussion_segments_queue
  ON discussion_transcript_segments(status, next_attempt_at, created_at);

CREATE TABLE discussion_organizations (
  id TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  input_transcript_sha256 TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_ref TEXT NOT NULL,
  organization_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (discussion_id, revision),
  FOREIGN KEY (discussion_id) REFERENCES discussion_captures(id) ON DELETE CASCADE
);

CREATE INDEX idx_discussion_organizations_latest
  ON discussion_organizations(discussion_id, revision DESC);
