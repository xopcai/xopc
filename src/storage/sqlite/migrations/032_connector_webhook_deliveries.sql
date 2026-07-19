CREATE TABLE IF NOT EXISTS connector_webhook_deliveries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('pending', 'processing', 'processed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  received_at TEXT NOT NULL,
  processing_at TEXT,
  processed_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_connector_webhook_deliveries_status
  ON connector_webhook_deliveries(provider, status, received_at DESC);
