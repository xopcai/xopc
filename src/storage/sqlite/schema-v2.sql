-- xopc schema v2: cron_runs, notes, memory_files, memory_chunks,
-- notes_fts, memory_fts

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
  task_due_at           INTEGER
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
