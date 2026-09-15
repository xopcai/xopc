CREATE TABLE discussion_action_tasks (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  organization_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(discussion_id, action_id)
);
