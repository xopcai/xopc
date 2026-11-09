CREATE TABLE observation_routines (
  id TEXT PRIMARY KEY, topic_id TEXT NOT NULL UNIQUE REFERENCES home_observation_topics(id),
  owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, source_conversation_id TEXT NOT NULL,
  project_id TEXT, agent_id TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','paused','ended')), revision INTEGER NOT NULL DEFAULT 1,
  adopted_version INTEGER NOT NULL, automation_id TEXT NOT NULL UNIQUE,
  trial_task_id TEXT NOT NULL, contract_json TEXT NOT NULL, context_json TEXT NOT NULL,
  valid_until INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE observation_methods (
  routine_id TEXT NOT NULL REFERENCES observation_routines(id), version INTEGER NOT NULL,
  base_version INTEGER, additions_json TEXT NOT NULL, feedback_ids_json TEXT NOT NULL,
  content_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('candidate','validating','validated','approved','rejected')),
  validation_task_id TEXT, validation_contract_hash TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY(routine_id, version)
);
CREATE TABLE observation_routine_executions (
  automation_run_id TEXT PRIMARY KEY REFERENCES automation_runs(run_id),
  routine_id TEXT NOT NULL REFERENCES observation_routines(id), version INTEGER NOT NULL,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id), contract_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE observation_routine_operations (
  owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, result_id TEXT NOT NULL,
  PRIMARY KEY(owner_id,workspace_id,operation_id)
);

CREATE INDEX observation_routines_owner ON observation_routines(owner_id, workspace_id, created_at DESC);
CREATE INDEX observation_methods_validation ON observation_methods(validation_task_id);
CREATE INDEX observation_routine_execution_history ON observation_routine_executions(routine_id, created_at DESC);
