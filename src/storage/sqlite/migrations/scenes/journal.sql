CREATE TABLE scene_cutover_journal (
      version INTEGER PRIMARY KEY CHECK(version = 1), phase TEXT NOT NULL CHECK(phase IN ('db_committed', 'complete')),
      config_path TEXT NOT NULL, pending_path TEXT NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, snapshot_path TEXT NOT NULL
    );
