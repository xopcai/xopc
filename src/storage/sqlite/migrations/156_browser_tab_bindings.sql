CREATE TABLE browser_tab_bindings (
  binding_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  endpoint_id TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  url_origin TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('read', 'act')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_browser_tab_bindings_expiry ON browser_tab_bindings(expires_at);
