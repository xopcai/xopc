CREATE TABLE task_main_agent_links (
  task_id TEXT PRIMARY KEY REFERENCES tasks(task_id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  origin_conversation_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_task_main_agent_links_agent_created
  ON task_main_agent_links(agent_id, created_at DESC);

INSERT INTO task_main_agent_links (task_id, agent_id, origin_conversation_id, created_at)
SELECT origin.task_id, session.agent_id, origin.conversation_id, origin.created_at
FROM task_origin_links origin
JOIN sessions session ON session.conversation_id = origin.conversation_id;
