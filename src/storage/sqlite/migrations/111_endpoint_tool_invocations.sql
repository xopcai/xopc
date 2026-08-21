CREATE TABLE endpoint_tool_invocations (
  id                    TEXT PRIMARY KEY,
  principal_id          TEXT NOT NULL,
  endpoint_id           TEXT NOT NULL,
  tool_call_id          TEXT NOT NULL,
  tool_name             TEXT NOT NULL,
  effect                TEXT NOT NULL CHECK(effect IN ('read', 'write', 'destructive')),
  confirmation_required INTEGER NOT NULL CHECK(confirmation_required IN (0, 1)),
  arguments_sha256      TEXT NOT NULL,
  status                TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
  error_code            TEXT,
  error_message         TEXT,
  started_at            INTEGER NOT NULL,
  completed_at          INTEGER
);

CREATE INDEX idx_endpoint_tool_invocations_endpoint_started
  ON endpoint_tool_invocations(endpoint_id, started_at DESC);
