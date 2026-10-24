ALTER TABLE ai_usage_events ADD COLUMN otel_trace_id TEXT;
ALTER TABLE ai_usage_events ADD COLUMN otel_span_id TEXT;
CREATE INDEX idx_ai_usage_events_otel_trace ON ai_usage_events(otel_trace_id) WHERE otel_trace_id IS NOT NULL;
