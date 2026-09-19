CREATE TABLE understanding_refresh_batches (
  batch_id TEXT PRIMARY KEY,
  source_run_ids_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_understanding_refresh_batches_created ON understanding_refresh_batches(created_at DESC);
