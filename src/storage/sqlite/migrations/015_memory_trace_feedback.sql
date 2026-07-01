ALTER TABLE memory_trace_events ADD COLUMN feedback_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_memory_trace_phase_created
  ON memory_trace_events(phase, created_at DESC);
