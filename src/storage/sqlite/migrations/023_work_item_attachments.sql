CREATE TABLE IF NOT EXISTS work_item_attachments (
  id            TEXT PRIMARY KEY,
  work_item_id  TEXT NOT NULL,
  media_uri     TEXT NOT NULL,
  media_id      TEXT NOT NULL,
  bucket        TEXT NOT NULL,
  type          TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  size          INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_item_attachments_item
  ON work_item_attachments(work_item_id, created_at DESC);
