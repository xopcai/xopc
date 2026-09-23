CREATE TABLE agent_catalog_settings (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  default_agent_id TEXT NOT NULL REFERENCES agents(id),
  defaults_json TEXT NOT NULL CHECK(json_valid(defaults_json)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  workspace_override TEXT,
  profile_json TEXT CHECK(profile_json IS NULL OR json_valid(profile_json)),
  overrides_json TEXT NOT NULL CHECK(json_valid(overrides_json)),
  provisioning_state TEXT NOT NULL CHECK(provisioning_state IN ('pending', 'ready', 'error')),
  provisioning_error TEXT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_agents_available ON agents(enabled, provisioning_state, deleted_at, id);

CREATE TABLE agent_bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  position INTEGER NOT NULL CHECK(position >= 0),
  rule_json TEXT NOT NULL CHECK(json_valid(rule_json)),
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(position)
);

CREATE INDEX idx_agent_bindings_agent ON agent_bindings(agent_id, position);

CREATE TABLE agent_surface_defaults (
  surface TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE agent_provisioning_jobs (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK(operation IN ('provision', 'purge')),
  state TEXT NOT NULL CHECK(state IN ('pending', 'running', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE application_migrations (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  source_digest TEXT,
  source_backup_path TEXT,
  database_backup_path TEXT,
  error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
