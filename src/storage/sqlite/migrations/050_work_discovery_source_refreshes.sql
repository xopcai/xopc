CREATE TABLE IF NOT EXISTS work_discovery_source_refreshes (
  refresh_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  discovery_run_id TEXT,
  changed INTEGER NOT NULL CHECK (changed IN (0, 1)),
  previous_fingerprint_json TEXT,
  current_fingerprint_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('checked', 'queued', 'completed', 'failed')),
  checked_at INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES work_discovery_sources(source_id) ON DELETE CASCADE,
  FOREIGN KEY (discovery_run_id) REFERENCES work_discovery_runs(id) ON DELETE SET NULL
);

CREATE INDEX idx_work_discovery_source_refreshes_source
  ON work_discovery_source_refreshes(source_id, checked_at DESC);
