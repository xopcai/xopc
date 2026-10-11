ALTER TABLE devices ADD COLUMN request_proof_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE device_request_nonces (
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, nonce)
) WITHOUT ROWID;
CREATE INDEX device_request_nonces_expiry ON device_request_nonces(expires_at);
