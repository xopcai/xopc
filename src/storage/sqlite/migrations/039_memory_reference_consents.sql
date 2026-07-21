CREATE TABLE IF NOT EXISTS memory_reference_consents (
  consent_id   TEXT PRIMARY KEY,
  record_id    TEXT NOT NULL,
  session_key  TEXT NOT NULL,
  purpose      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'granted', 'denied', 'consumed')),
  grant_scope  TEXT CHECK (grant_scope IN ('once', 'session', 'always')),
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (record_id) REFERENCES memory_records(record_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_reference_consents_pending
  ON memory_reference_consents(record_id, session_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_memory_reference_consents_resolution
  ON memory_reference_consents(record_id, status, session_key, expires_at);
