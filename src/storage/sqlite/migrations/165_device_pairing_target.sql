-- Pairing state is short-lived, so replace the tables instead of carrying the
-- retired protocol discriminator into the device-targeted flow.
DROP TABLE device_pairing_requests;
DROP TABLE device_pairing_sessions;

CREATE TABLE device_pairing_sessions (
  pairing_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  routes_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts_remaining INTEGER NOT NULL CHECK (attempts_remaining >= 0),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  enrollment_issuer TEXT,
  enrollment_extension_id TEXT,
  enrollment_public_key_thumbprint TEXT,
  enrollment_nonce TEXT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('mobile', 'browser'))
);

CREATE INDEX idx_device_pairing_sessions_expiry
  ON device_pairing_sessions(expires_at);

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

CREATE INDEX idx_device_pairing_requests_expiry
  ON device_pairing_requests(recovery_until);
