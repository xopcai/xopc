-- xopc SQLite schema: sessions, transcripts, cron, notes, memory, FTS

CREATE TABLE IF NOT EXISTS sessions (
  session_key              TEXT PRIMARY KEY,
  agent_id                 TEXT NOT NULL,
  current_transcript_id    TEXT NOT NULL UNIQUE,
  status                   TEXT NOT NULL DEFAULT 'active',
  name                     TEXT,
  tags_json                TEXT NOT NULL DEFAULT '[]',
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  last_accessed_at         INTEGER NOT NULL,
  session_started_at       INTEGER,
  last_interaction_at      INTEGER,
  source_channel           TEXT NOT NULL DEFAULT '',
  source_chat_id           TEXT NOT NULL DEFAULT '',
  session_type             TEXT,
  routing_json             TEXT,
  custom_data_json         TEXT,
  abort_cutoff_timestamp   INTEGER,
  message_count            INTEGER NOT NULL DEFAULT 0,
  estimated_tokens         INTEGER NOT NULL DEFAULT 0,
  compacted_count          INTEGER NOT NULL DEFAULT 0,
  last_flushed_at          TEXT,
  flush_count              INTEGER NOT NULL DEFAULT 0,
  thinking_level           TEXT,
  verbose_level            TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent_updated
  ON sessions(agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_source_channel
  ON sessions(source_channel);
CREATE INDEX IF NOT EXISTS idx_sessions_last_interaction
  ON sessions(last_interaction_at DESC);

CREATE TABLE IF NOT EXISTS session_config (
  session_key                  TEXT PRIMARY KEY,
  thinking_level               TEXT,
  reasoning_level              TEXT,
  verbose_level                TEXT,
  elevated_mode                TEXT,
  model_override               TEXT,
  provider_override            TEXT,
  working_directory_override   TEXT,
  updated_at                   INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transcripts (
  transcript_id    TEXT PRIMARY KEY,
  session_key        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  archive_reason     TEXT,
  created_at         INTEGER NOT NULL,
  archived_at        INTEGER,
  cwd                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transcripts_session
  ON transcripts(session_key, status);

CREATE TABLE IF NOT EXISTS transcript_entries (
  entry_id        TEXT PRIMARY KEY,
  transcript_id   TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  entry_kind      TEXT NOT NULL,
  role            TEXT,
  payload_json    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(transcript_id, seq),
  FOREIGN KEY (transcript_id) REFERENCES transcripts(transcript_id)
);

CREATE INDEX IF NOT EXISTS idx_entries_transcript_seq
  ON transcript_entries(transcript_id, seq);
CREATE INDEX IF NOT EXISTS idx_entries_kind
  ON transcript_entries(transcript_id, entry_kind);

CREATE TABLE IF NOT EXISTS compaction_checkpoints (
  checkpoint_id    TEXT PRIMARY KEY,
  transcript_id    TEXT NOT NULL,
  session_key      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  message_count    INTEGER NOT NULL,
  size_bytes       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoint_entries (
  checkpoint_id   TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  entry_kind      TEXT NOT NULL,
  role            TEXT,
  payload_json    TEXT NOT NULL,
  PRIMARY KEY (checkpoint_id, seq),
  FOREIGN KEY (checkpoint_id) REFERENCES compaction_checkpoints(checkpoint_id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
  content,
  session_key UNINDEXED,
  transcript_id UNINDEXED,
  entry_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS cron_runs (
  run_id            TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL,
  status            TEXT NOT NULL,
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  duration_ms       INTEGER,
  error             TEXT,
  output            TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  summary           TEXT,
  session_id        TEXT,
  session_key       TEXT,
  session_type      TEXT,
  model             TEXT,
  provider          TEXT,
  usage_json        TEXT,
  workflow_run_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started
  ON cron_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started
  ON cron_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  note_id               TEXT PRIMARY KEY,
  title                 TEXT,
  kind                  TEXT NOT NULL,
  status                TEXT NOT NULL,
  payload_json          TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  pinned                INTEGER NOT NULL DEFAULT 0,
  tags_json             TEXT NOT NULL DEFAULT '[]',
  snippet               TEXT,
  cover_attachment_id   TEXT,
  voice_attachment_id   TEXT,
  voice_duration_sec    REAL,
  attachment_names_json TEXT,
  group_id              TEXT,
  last_opened_at        INTEGER,
  task_done             INTEGER,
  task_due_at           INTEGER,
  heading_count         INTEGER,
  task_count            INTEGER,
  unchecked_task_count  INTEGER,
  link_count            INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notes_status_updated
  ON notes(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_kind
  ON notes(kind);
CREATE INDEX IF NOT EXISTS idx_notes_group
  ON notes(group_id);

CREATE TABLE IF NOT EXISTS memory_files (
  file_id       TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  path          TEXT NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  UNIQUE(agent_id, path)
);

CREATE TABLE IF NOT EXISTS memory_chunks (
  chunk_id    TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL,
  start_line  INTEGER NOT NULL,
  end_line    INTEGER NOT NULL,
  content     TEXT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES memory_files(file_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_file
  ON memory_chunks(file_id, start_line);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  content,
  note_id UNINDEXED,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  chunk_id UNINDEXED,
  agent_id UNINDEXED,
  path UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED,
  tokenize='unicode61'
);
