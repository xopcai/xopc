CREATE TABLE execution_environments (
  environment_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
  host_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('local_checkout', 'managed_worktree')),
  status TEXT NOT NULL CHECK (status IN (
    'requested', 'provisioning', 'ready', 'busy', 'snapshotting',
    'handing_off', 'degraded', 'stopped', 'deleting', 'deleted', 'error'
  )),
  root_path TEXT NOT NULL CHECK (length(root_path) > 0),
  repository_root TEXT,
  git_common_dir TEXT,
  base_ref TEXT,
  base_sha TEXT,
  branch_ref TEXT,
  managed INTEGER NOT NULL CHECK (managed IN (0, 1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  deleted_at INTEGER,
  CHECK (
    (kind = 'local_checkout' AND managed = 0) OR
    (kind = 'managed_worktree' AND managed = 1)
  )
);

CREATE UNIQUE INDEX idx_execution_environments_active_root
  ON execution_environments(host_id, root_path)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_execution_environments_project
  ON execution_environments(project_id, updated_at DESC);

CREATE INDEX idx_execution_environments_host_status
  ON execution_environments(host_id, status, updated_at DESC);

CREATE TABLE execution_environment_bindings (
  binding_id TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN (
    'session', 'task_run', 'automation_run', 'workflow_run'
  )),
  subject_id TEXT NOT NULL,
  environment_id TEXT NOT NULL REFERENCES execution_environments(environment_id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL CHECK (epoch > 0),
  created_at INTEGER NOT NULL,
  released_at INTEGER
);

CREATE UNIQUE INDEX idx_execution_environment_bindings_active_subject
  ON execution_environment_bindings(subject_kind, subject_id)
  WHERE released_at IS NULL;

CREATE INDEX idx_execution_environment_bindings_environment
  ON execution_environment_bindings(environment_id, created_at DESC);

CREATE TABLE execution_environment_events (
  event_id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES execution_environments(environment_id) ON DELETE CASCADE,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN (
    'requested', 'provisioning', 'ready', 'busy', 'snapshotting',
    'handing_off', 'degraded', 'stopped', 'deleting', 'deleted', 'error'
  )),
  to_status TEXT NOT NULL CHECK (to_status IN (
    'requested', 'provisioning', 'ready', 'busy', 'snapshotting',
    'handing_off', 'degraded', 'stopped', 'deleting', 'deleted', 'error'
  )),
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_execution_environment_events_environment
  ON execution_environment_events(environment_id, created_at DESC);
