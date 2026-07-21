CREATE TABLE IF NOT EXISTS local_apps (
  app_id          TEXT PRIMARY KEY,
  extension_id    TEXT NOT NULL UNIQUE,
  project_id      TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  idea            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('preview_ready', 'installed', 'degraded')),
  workspace_root  TEXT NOT NULL UNIQUE,
  preview_token   TEXT NOT NULL UNIQUE,
  draft_version   INTEGER NOT NULL DEFAULT 1,
  active_version  INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  installed_at    INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_local_apps_updated_at ON local_apps(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_apps_status ON local_apps(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS local_app_releases (
  release_id      TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL,
  version         INTEGER NOT NULL,
  source_hash     TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(app_id, version),
  FOREIGN KEY (app_id) REFERENCES local_apps(app_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_local_app_releases_app ON local_app_releases(app_id, version DESC);
