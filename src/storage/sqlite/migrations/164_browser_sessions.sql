CREATE TABLE browser_sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  auth_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_browser_sessions_expiry ON browser_sessions(expires_at);
