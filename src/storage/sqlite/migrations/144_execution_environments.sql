CREATE TABLE execution_environments (
  environment_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('local_checkout', 'managed_worktree')),
  status TEXT NOT NULL CHECK (status IN (
    'requested', 'provisioning', 'ready', 'degraded', 'deleting', 'deleted', 'error'
  )),
  root_path TEXT NOT NULL CHECK (length(root_path) > 0),
  repository_root TEXT,
  git_common_dir TEXT,
  base_ref TEXT,
  base_sha TEXT,
  branch_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX idx_execution_environments_active_root
  ON execution_environments(root_path)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_execution_environments_project
  ON execution_environments(project_id, updated_at DESC);

CREATE TABLE execution_environment_bindings (
  binding_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  environment_id TEXT NOT NULL REFERENCES execution_environments(environment_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  released_at INTEGER
);

CREATE UNIQUE INDEX idx_execution_environment_bindings_active_session
  ON execution_environment_bindings(session_key)
  WHERE released_at IS NULL;

CREATE INDEX idx_execution_environment_bindings_environment
  ON execution_environment_bindings(environment_id, created_at DESC);

CREATE TABLE execution_environment_events (
  event_id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES execution_environments(environment_id) ON DELETE CASCADE,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN (
    'requested', 'provisioning', 'ready', 'degraded', 'deleting', 'deleted', 'error'
  )),
  to_status TEXT NOT NULL CHECK (to_status IN (
    'requested', 'provisioning', 'ready', 'degraded', 'deleting', 'deleted', 'error'
  )),
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_execution_environment_events_environment
  ON execution_environment_events(environment_id, created_at DESC);
