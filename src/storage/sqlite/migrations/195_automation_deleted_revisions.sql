CREATE TABLE automation_deleted_revisions (
  automation_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);
