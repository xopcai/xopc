CREATE TABLE device_grant_events (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  requestor_principal_id TEXT NOT NULL,
  target_principal_id TEXT NOT NULL,
  target_endpoint_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_sha256 TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('issued','reserved','consumed','revoked','expired')),
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX device_grant_events_conversation ON device_grant_events(conversation_id, created_at_ms);
