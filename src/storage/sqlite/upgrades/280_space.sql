CREATE TABLE space_items (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0, 1)),
  trashed_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE INDEX space_items_updated ON space_items(trashed_at, updated_at DESC, id DESC);

CREATE TABLE space_versions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES space_items(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  media_id TEXT,
  body TEXT,
  sha256 TEXT,
  index_status TEXT NOT NULL DEFAULT 'pending' CHECK(index_status IN ('pending','ready','unsupported','failed')),
  created_at INTEGER NOT NULL,
  UNIQUE(item_id, ordinal),
  CHECK((media_id IS NULL) != (body IS NULL))
);

CREATE INDEX space_versions_media ON space_versions(media_id) WHERE media_id IS NOT NULL;
CREATE INDEX space_versions_pending ON space_versions(created_at) WHERE index_status = 'pending';

CREATE TABLE space_origins (
  source_key TEXT PRIMARY KEY,
  item_id TEXT REFERENCES space_items(id) ON DELETE SET NULL,
  version_id TEXT REFERENCES space_versions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('chat', 'task', 'automation')),
  conversation_id TEXT NOT NULL,
  transcript_id TEXT,
  entry_id TEXT,
  project_id TEXT,
  task_id TEXT,
  automation_run_id TEXT,
  label TEXT
);

CREATE INDEX space_origins_item ON space_origins(item_id);
CREATE INDEX space_origins_task ON space_origins(task_id, item_id);
CREATE INDEX space_origins_project ON space_origins(project_id, item_id);

CREATE VIRTUAL TABLE space_search USING fts5(version_id UNINDEXED, body, locator UNINDEXED, tokenize='trigram');
CREATE VIRTUAL TABLE space_search_short USING fts5(version_id UNINDEXED, terms, body UNINDEXED, locator UNINDEXED);

CREATE TABLE space_backfill (
  source TEXT PRIMARY KEY,
  cursor INTEGER NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0, 1))
);

CREATE TABLE space_media_cleanup (media_id TEXT PRIMARY KEY);
