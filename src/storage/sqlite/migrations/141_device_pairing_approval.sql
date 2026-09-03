ALTER TABLE device_pairing_sessions ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 2;

CREATE TABLE device_pairing_requests (
  request_id TEXT PRIMARY KEY,
  pairing_id TEXT NOT NULL UNIQUE REFERENCES device_pairing_sessions(pairing_id) ON DELETE CASCADE,
  device_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'cancelled', 'expired')),
  revision INTEGER NOT NULL DEFAULT 1,
  confirmation_code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  recovery_until INTEGER NOT NULL,
  completion_key TEXT,
  initial_token_hash TEXT,
  device_id TEXT REFERENCES devices(device_id),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_device_pairing_requests_expiry ON device_pairing_requests(recovery_until);
