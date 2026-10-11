ALTER TABLE ai_usage_events ADD COLUMN cloud_request_id TEXT;
ALTER TABLE ai_usage_events ADD COLUMN cloud_billing_json TEXT
  CHECK(cloud_billing_json IS NULL OR json_valid(cloud_billing_json));
CREATE UNIQUE INDEX idx_ai_usage_cloud_request
  ON ai_usage_events(cloud_request_id) WHERE cloud_request_id IS NOT NULL;
