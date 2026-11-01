CREATE TABLE desktop_execution_grants (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  grant_id TEXT NOT NULL, approval_id TEXT NOT NULL, grant_json TEXT NOT NULL CHECK (json_valid(grant_json)),
  active INTEGER NOT NULL CHECK (active IN (0, 1)), updated_at INTEGER NOT NULL
);
CREATE TABLE desktop_execution_grant_events (
  event_id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, grant_id TEXT NOT NULL, approval_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked')), grant_json TEXT NOT NULL CHECK (json_valid(grant_json)), created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_desktop_execution_approval ON desktop_execution_grant_events(device_id, approval_id) WHERE action = 'granted';
CREATE UNIQUE INDEX idx_desktop_execution_grant ON desktop_execution_grant_events(device_id, grant_id) WHERE action = 'granted';
ALTER TABLE capability_operations ADD COLUMN desktop_intent_json TEXT CHECK (desktop_intent_json IS NULL OR json_valid(desktop_intent_json));
ALTER TABLE capability_operations ADD COLUMN desktop_receipt_json TEXT CHECK (desktop_receipt_json IS NULL OR json_valid(desktop_receipt_json));
