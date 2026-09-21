-- Scene-specific source and delivery metadata; Task and TaskRun remain authoritative.
CREATE TABLE scene_development_bindings (
  activation_id TEXT PRIMARY KEY REFERENCES scene_activations(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id) ON DELETE CASCADE,
  source_key TEXT NOT NULL UNIQUE,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  environment_id TEXT REFERENCES execution_environments(environment_id),
  resource_operation_id TEXT,
  observed_revision INTEGER NOT NULL DEFAULT 0,
  delivered_revision INTEGER NOT NULL DEFAULT 0,
  delivered_decisions_hash TEXT NOT NULL DEFAULT '',
  applied_revision INTEGER NOT NULL DEFAULT 0,
  executing_run_id TEXT REFERENCES task_runs(run_id),
  last_error TEXT,
  next_poll_at INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE scene_development_revisions (
  activation_id TEXT NOT NULL REFERENCES scene_development_bindings(activation_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(activation_id, revision)
);
CREATE INDEX scene_development_poll ON scene_development_bindings(next_poll_at);
CREATE TABLE scene_development_branch_links (
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  branch_ref TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  confirmed_sha TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, workspace_id, project_id, branch_ref)
);
