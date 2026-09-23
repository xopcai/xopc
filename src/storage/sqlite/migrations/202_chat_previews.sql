CREATE TABLE chat_previews (
  preview_id       TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES sessions(conversation_id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  preferred_height INTEGER NOT NULL CHECK (preferred_height BETWEEN 240 AND 720),
  latest_revision  TEXT NOT NULL CHECK (length(latest_revision) = 64),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_chat_previews_conversation_updated
  ON chat_previews(conversation_id, updated_at DESC);

CREATE TABLE chat_preview_revisions (
  preview_id  TEXT NOT NULL REFERENCES chat_previews(preview_id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  markup      TEXT NOT NULL,
  styles      TEXT NOT NULL,
  script      TEXT NOT NULL,
  promoted_app_id TEXT UNIQUE REFERENCES local_apps(app_id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (preview_id, source_hash)
);

CREATE INDEX idx_chat_preview_revisions_created
  ON chat_preview_revisions(preview_id, created_at DESC);
