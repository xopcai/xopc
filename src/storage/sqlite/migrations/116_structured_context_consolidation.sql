DELETE FROM automations
WHERE automation_id LIKE 'system-user-context-dreaming:%'
   OR automation_id IN ('system-dreaming-light', 'system-dreaming-deep', 'system-dreaming-rem');

DELETE FROM memory_records
WHERE tags_json LIKE '%"user-understanding"%';

DELETE FROM memory_trace_events
WHERE provider_id = 'user-understanding' OR phase = 'understanding';

DROP TABLE IF EXISTS dreaming_decisions;
DROP TABLE IF EXISTS dreaming_runs;

CREATE TABLE context_consolidation_runs (
  run_id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('schedule', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  reason TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_context_consolidation_runs_started
  ON context_consolidation_runs(started_at DESC);

CREATE TABLE context_consolidation_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES context_consolidation_runs(run_id) ON DELETE CASCADE,
  understanding_id TEXT REFERENCES user_understandings(understanding_id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('needs_review', 'stale')),
  reason_code TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_context_consolidation_decisions_run
  ON context_consolidation_decisions(run_id, created_at);
