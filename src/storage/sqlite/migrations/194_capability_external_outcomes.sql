ALTER TABLE capability_operations ADD COLUMN state TEXT NOT NULL DEFAULT 'succeeded'
  CHECK (state IN ('running', 'succeeded', 'failed', 'unknown'));
ALTER TABLE capability_operations ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE capability_operations ADD COLUMN recovery_mode TEXT NOT NULL DEFAULT 'atomic'
  CHECK (recovery_mode IN ('atomic', 'manual', 'provider-idempotent'));
ALTER TABLE capability_operations ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE capability_operations ADD COLUMN evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json));
ALTER TABLE capability_invocations ADD COLUMN state TEXT NOT NULL DEFAULT 'succeeded'
  CHECK (state IN ('running', 'succeeded', 'failed', 'unknown'));
ALTER TABLE capability_invocations ADD COLUMN finished_at INTEGER;
ALTER TABLE domain_outbox ADD COLUMN operation_id TEXT;
