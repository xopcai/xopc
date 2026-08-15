ALTER TABLE proactive_insights ADD COLUMN content_fingerprint TEXT;

CREATE INDEX idx_proactive_insights_fingerprint
  ON proactive_insights(subscription_id, scenario_key, content_fingerprint, created_at DESC);
