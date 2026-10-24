CREATE INDEX idx_ai_usage_events_provider_model
  ON ai_usage_events(provider, model, started_at DESC);
