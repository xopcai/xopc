CREATE TABLE home_followups (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  root_task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id) ON DELETE CASCADE, root_contract_hash TEXT NOT NULL,
  topic_ids_json TEXT NOT NULL, goal TEXT NOT NULL, criteria_json TEXT NOT NULL, locale TEXT NOT NULL, agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('working','waiting','review','paused','done','ended')),
  revision INTEGER NOT NULL DEFAULT 1, next_step TEXT NOT NULL, waiting_for TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
  auto_continue INTEGER NOT NULL DEFAULT 0, remaining_steps INTEGER NOT NULL, next_sequence INTEGER NOT NULL DEFAULT 1, stop_pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX home_followups_owner ON home_followups(owner_id,workspace_id,updated_at DESC);
CREATE TABLE home_followup_steps (
  followup_id TEXT NOT NULL REFERENCES home_followups(id) ON DELETE CASCADE, sequence INTEGER NOT NULL,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id) ON DELETE CASCADE, action TEXT NOT NULL, contract_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL, processed_run_id TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY(followup_id,sequence)
);
CREATE TABLE home_followup_operations (
  owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, result_id TEXT NOT NULL,
  PRIMARY KEY(owner_id,workspace_id,operation_id)
);
