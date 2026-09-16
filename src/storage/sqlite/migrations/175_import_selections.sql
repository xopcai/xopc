CREATE TABLE import_selections (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inventory', 'run')),
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX import_selections_owner_kind ON import_selections(owner, kind, created_at DESC);
