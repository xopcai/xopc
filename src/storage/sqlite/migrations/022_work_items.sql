CREATE TABLE IF NOT EXISTS work_items (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal',
  owner_agent_id  TEXT,
  next_action     TEXT,
  blocked_reason  TEXT,
  due_at          INTEGER,
  completed_at    INTEGER,
  archived_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_items_project_status
  ON work_items(project_id, status, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS work_item_links (
  id               TEXT PRIMARY KEY,
  work_item_id     TEXT NOT NULL,
  kind             TEXT NOT NULL,
  target_id        TEXT NOT NULL,
  title            TEXT,
  status_snapshot  TEXT,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_links_item
  ON work_item_links(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_item_events (
  id            TEXT PRIMARY KEY,
  work_item_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_events_item
  ON work_item_events(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_item_update_suggestions (
  id             TEXT PRIMARY KEY,
  work_item_id   TEXT NOT NULL,
  source_kind    TEXT NOT NULL,
  source_id      TEXT NOT NULL,
  status         TEXT NOT NULL,
  patch_json     TEXT NOT NULL DEFAULT '{}',
  progress_note  TEXT,
  rationale      TEXT,
  confidence     REAL,
  created_at     INTEGER NOT NULL,
  applied_at     INTEGER,
  dismissed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_work_item_update_suggestions_item
  ON work_item_update_suggestions(work_item_id, status, created_at DESC);
