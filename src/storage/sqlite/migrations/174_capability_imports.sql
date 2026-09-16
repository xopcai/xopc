CREATE TABLE capability_imports (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('scan', 'plan', 'job', 'run')),
  created_at INTEGER NOT NULL,
  idempotency_key TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX capability_imports_owner_kind ON capability_imports(owner, kind, created_at DESC);
CREATE UNIQUE INDEX capability_imports_idempotency ON capability_imports(owner, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
