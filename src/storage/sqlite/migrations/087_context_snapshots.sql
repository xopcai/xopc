CREATE TABLE context_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  query TEXT NOT NULL,
  selected_items_json TEXT NOT NULL DEFAULT '[]',
  rejected_items_json TEXT NOT NULL DEFAULT '[]',
  consent_requests_json TEXT NOT NULL DEFAULT '[]',
  relationship_policy_json TEXT NOT NULL DEFAULT '{}',
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  outcome_id TEXT,
  run_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (outcome_id) REFERENCES outcomes(outcome_id) ON DELETE SET NULL,
  FOREIGN KEY (run_id) REFERENCES execution_receipts(run_id) ON DELETE SET NULL
);

CREATE INDEX idx_context_snapshots_session_created
  ON context_snapshots(session_key, created_at DESC);
CREATE INDEX idx_context_snapshots_outcome
  ON context_snapshots(outcome_id, created_at DESC);
