CREATE TABLE IF NOT EXISTS activity_events (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,
  primary_object_kind   TEXT NOT NULL,
  primary_object_id     TEXT NOT NULL,
  primary_object_title  TEXT,
  actor_json            TEXT NOT NULL,
  initiator_json        TEXT,
  source_json           TEXT NOT NULL,
  payload_json          TEXT NOT NULL DEFAULT '{}',
  visibility            TEXT NOT NULL,
  importance            TEXT NOT NULL,
  created_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_events_created
  ON activity_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_events_object_created
  ON activity_events(primary_object_kind, primary_object_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_scopes (
  activity_id  TEXT NOT NULL,
  scope_kind   TEXT NOT NULL,
  scope_id     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  PRIMARY KEY (activity_id, scope_kind, scope_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_activity_scopes_scope
  ON activity_scopes(scope_kind, scope_id, activity_id);

CREATE TABLE IF NOT EXISTS object_links (
  id          TEXT PRIMARY KEY,
  from_kind   TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  from_title  TEXT,
  to_kind     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  to_title    TEXT,
  relation    TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_object_links_from
  ON object_links(from_kind, from_id);

CREATE INDEX IF NOT EXISTS idx_object_links_to
  ON object_links(to_kind, to_id);

CREATE TABLE IF NOT EXISTS activity_related_projects (
  activity_id  TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  reason       TEXT NOT NULL,
  confidence   REAL NOT NULL,
  computed_at  INTEGER NOT NULL,
  PRIMARY KEY (activity_id, project_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_activity_related_projects_project
  ON activity_related_projects(project_id, activity_id);
