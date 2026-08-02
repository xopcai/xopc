CREATE TABLE IF NOT EXISTS work_understanding_investigations (
  investigation_id TEXT PRIMARY KEY,
  discovery_run_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'planning', 'investigating', 'synthesizing', 'completed', 'failed', 'canceled'
  )),
  plan_json TEXT NOT NULL DEFAULT '{}',
  budget_json TEXT NOT NULL,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  content_chars_read INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (discovery_run_id) REFERENCES work_discovery_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_understanding_evidence (
  evidence_id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  source_grant_id TEXT,
  project_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'file', 'git', 'project_metadata', 'personal_context', 'session', 'user_statement'
  )),
  source_ref TEXT NOT NULL,
  observation TEXT NOT NULL,
  content_hash TEXT,
  observed_at INTEGER,
  collected_at INTEGER NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'restricted')),
  FOREIGN KEY (investigation_id) REFERENCES work_understanding_investigations(investigation_id) ON DELETE CASCADE,
  FOREIGN KEY (source_grant_id) REFERENCES work_discovery_sources(source_id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE SET NULL
);

CREATE INDEX idx_work_understanding_evidence_investigation
  ON work_understanding_evidence(investigation_id, collected_at ASC);

CREATE INDEX idx_work_understanding_evidence_source
  ON work_understanding_evidence(source_grant_id, source_type, collected_at DESC);
