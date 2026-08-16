CREATE TABLE session_task_plans (
  session_id  TEXT NOT NULL,
  plan_id     TEXT NOT NULL,
  items_json  TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (session_id, plan_id),
  FOREIGN KEY (session_id) REFERENCES transcripts(session_id) ON DELETE CASCADE
);
