CREATE TABLE capability_operations (
  operation_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  descriptor_digest TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at INTEGER NOT NULL,
  UNIQUE(principal_id, capability_id, idempotency_key)
);

CREATE TABLE capability_invocations (
  invocation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES capability_operations(operation_id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  replayed INTEGER NOT NULL CHECK (replayed IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX capability_invocations_operation ON capability_invocations(operation_id, created_at);
