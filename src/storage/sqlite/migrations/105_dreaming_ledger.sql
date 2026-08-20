CREATE TABLE dreaming_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('light', 'deep', 'rem')),
  mode TEXT NOT NULL CHECK (mode IN ('observe', 'review', 'automatic')),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('schedule', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  reason TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_dreaming_runs_agent_started
  ON dreaming_runs(agent_id, started_at DESC);
CREATE INDEX idx_dreaming_runs_workspace_started
  ON dreaming_runs(workspace_id, started_at DESC);

CREATE TABLE dreaming_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES dreaming_runs(run_id) ON DELETE CASCADE,
  record_id TEXT REFERENCES memory_records(record_id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('observe', 'propose', 'activate', 'skip')),
  reason_code TEXT NOT NULL,
  score REAL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_dreaming_decisions_run
  ON dreaming_decisions(run_id, created_at);
CREATE INDEX idx_dreaming_decisions_record
  ON dreaming_decisions(record_id, created_at DESC);
