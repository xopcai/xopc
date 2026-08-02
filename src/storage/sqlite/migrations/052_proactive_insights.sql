CREATE TABLE proactive_insights (
  insight_id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('progress', 'staleness', 'deadline', 'intelligence')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  next_action TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unread', 'read', 'approved', 'dismissed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (watch_id) REFERENCES focus_watches(watch_id) ON DELETE CASCADE
);

CREATE INDEX idx_proactive_insights_status
  ON proactive_insights(status, created_at DESC);

CREATE INDEX idx_proactive_insights_watch
  ON proactive_insights(watch_id, created_at DESC);

CREATE UNIQUE INDEX idx_proactive_insights_dedupe
  ON proactive_insights(watch_id, content_hash);
