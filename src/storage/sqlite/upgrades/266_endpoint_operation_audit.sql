ALTER TABLE endpoint_tool_invocations ADD COLUMN operation_id TEXT;
CREATE INDEX idx_endpoint_tool_invocations_operation
  ON endpoint_tool_invocations(operation_id) WHERE operation_id IS NOT NULL;
