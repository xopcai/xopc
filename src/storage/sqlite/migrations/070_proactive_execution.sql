CREATE TABLE proactive_context_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  content_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES proactive_signal_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE proactive_runs (
  run_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  subscription_id TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  scenario_version INTEGER NOT NULL,
  prompt_revision_id TEXT,
  context_snapshot_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'discarded', 'retryable', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  model_ref TEXT,
  raw_output TEXT,
  error_message TEXT,
  next_attempt_at TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES proactive_signal_batches(batch_id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES proactive_scenario_subscriptions(subscription_id) ON DELETE CASCADE,
  FOREIGN KEY (prompt_revision_id) REFERENCES proactive_prompt_revisions(revision_id),
  FOREIGN KEY (context_snapshot_id) REFERENCES proactive_context_snapshots(snapshot_id)
);

CREATE TABLE proactive_insights (
  insight_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  subscription_id TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_now TEXT NOT NULL,
  impact TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  value_score REAL NOT NULL CHECK (value_score >= 0 AND value_score <= 1),
  evidence_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES proactive_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES proactive_scenario_subscriptions(subscription_id) ON DELETE CASCADE
);

CREATE INDEX idx_proactive_runs_status_lease ON proactive_runs(status, next_attempt_at, lease_expires_at, updated_at);
CREATE INDEX idx_proactive_insights_created ON proactive_insights(created_at DESC);
