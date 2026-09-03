ALTER TABLE execution_environment_handoffs ADD COLUMN artifact_id TEXT;
ALTER TABLE execution_environment_handoffs ADD COLUMN artifact_size INTEGER;
ALTER TABLE execution_environment_handoffs ADD COLUMN artifact_sha256 TEXT;
