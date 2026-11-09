CREATE TABLE home_observation_sessions (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','paused')), revision INTEGER NOT NULL DEFAULT 1,
  start_at INTEGER NOT NULL, last_processed_at INTEGER, analyzed_revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(owner_id, workspace_id)
);
CREATE TABLE home_observation_topics (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES home_observation_sessions(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL, title TEXT NOT NULL, project_id TEXT, revision INTEGER NOT NULL DEFAULT 1,
  excluded INTEGER NOT NULL DEFAULT 0, discussion_conversation_id TEXT, UNIQUE(session_id, source_key)
);
CREATE TABLE home_observation_cursors (
  session_id TEXT NOT NULL REFERENCES home_observation_sessions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, through_seq INTEGER NOT NULL, PRIMARY KEY(session_id, source_id)
);
CREATE TABLE home_observation_entries (
  id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES home_observation_topics(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, source_ref TEXT,
  created_at INTEGER NOT NULL, UNIQUE(topic_id, source_key)
);
CREATE INDEX home_observation_entries_topic ON home_observation_entries(topic_id, created_at);
CREATE TABLE home_observation_feedback (
  id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES home_observation_topics(id) ON DELETE CASCADE,
  text TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('once','project','similar')),
  status TEXT NOT NULL CHECK(status IN ('active','retracted')), created_at INTEGER NOT NULL
);
CREATE TABLE home_observation_trials (
  id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES home_observation_topics(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES tasks(task_id),
  feedback_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(topic_id, opportunity_id)
);
CREATE TABLE home_observation_operations (
  session_id TEXT NOT NULL REFERENCES home_observation_sessions(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL, request_json TEXT NOT NULL, response_json TEXT NOT NULL,
  PRIMARY KEY(session_id, operation_id)
);
CREATE TABLE home_observation_analysis_sources (
  generation_id TEXT NOT NULL REFERENCES home_advice_generations(generation_id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES home_observation_topics(id) ON DELETE CASCADE,
  PRIMARY KEY(generation_id, topic_id)
);
