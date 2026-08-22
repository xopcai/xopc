ALTER TABLE user_profiles ADD COLUMN role TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN primary_goal TEXT NOT NULL DEFAULT '';

CREATE TABLE understanding_source_grants (
  grant_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  adapter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'files', 'recent_documents', 'calendar', 'tasks', 'notes',
    'mail', 'messages', 'code_activity'
  )),
  platform TEXT NOT NULL CHECK (platform IN ('darwin', 'win32', 'linux', 'all')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  access_mode TEXT NOT NULL CHECK (access_mode IN ('once', 'continuous')),
  retention_policy TEXT NOT NULL CHECK (retention_policy IN ('metadata_only', 'derived_only', 'bounded_raw')),
  processing_policy TEXT NOT NULL CHECK (processing_policy IN ('local_only', 'remote_allowed')),
  config_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  last_collected_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_understanding_source_grants_status
  ON understanding_source_grants(status, category, updated_at DESC);

CREATE TABLE understanding_source_runs (
  run_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'bootstrap', 'incremental', 'fingerprint')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'canceled')),
  cursor_before TEXT,
  cursor_after TEXT,
  items_seen INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (grant_id) REFERENCES understanding_source_grants(grant_id) ON DELETE CASCADE
);

CREATE INDEX idx_understanding_source_runs_grant
  ON understanding_source_runs(grant_id, started_at DESC);
CREATE INDEX idx_understanding_source_runs_status
  ON understanding_source_runs(status, started_at ASC);

CREATE TABLE user_focuses (
  focus_id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('current', 'ongoing', 'long_term')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'paused', 'completed', 'rejected')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  project_id TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  source_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL,
  FOREIGN KEY (source_run_id) REFERENCES understanding_source_runs(run_id) ON DELETE SET NULL
);

CREATE INDEX idx_user_focuses_status
  ON user_focuses(status, horizon, updated_at DESC);

-- Replace the work-discovery-only grant foreign key with the unified grant model.
CREATE TABLE work_understanding_evidence_v117 (
  evidence_id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  source_grant_id TEXT,
  project_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'file', 'git', 'project_metadata', 'understanding_source', 'session', 'user_statement'
  )),
  source_ref TEXT NOT NULL,
  observation TEXT NOT NULL,
  content_hash TEXT,
  observed_at INTEGER,
  collected_at INTEGER NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'restricted')),
  FOREIGN KEY (investigation_id) REFERENCES work_understanding_investigations(investigation_id) ON DELETE CASCADE,
  FOREIGN KEY (source_grant_id) REFERENCES understanding_source_grants(grant_id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

INSERT INTO work_understanding_evidence_v117 (
  evidence_id, investigation_id, source_grant_id, project_id, source_type,
  source_ref, observation, content_hash, observed_at, collected_at, sensitivity
)
SELECT
  evidence_id, investigation_id, NULL, project_id,
  CASE source_type
    WHEN 'personal_context' THEN 'understanding_source'
    ELSE source_type
  END,
  source_ref, observation, content_hash, observed_at, collected_at, sensitivity
FROM work_understanding_evidence;

DROP TABLE work_understanding_evidence;
ALTER TABLE work_understanding_evidence_v117 RENAME TO work_understanding_evidence;

CREATE INDEX idx_work_understanding_evidence_investigation
  ON work_understanding_evidence(investigation_id, collected_at ASC);
CREATE INDEX idx_work_understanding_evidence_source
  ON work_understanding_evidence(source_grant_id, source_type, collected_at DESC);

DROP TABLE work_discovery_source_refreshes;
DROP TABLE work_discovery_sources;
