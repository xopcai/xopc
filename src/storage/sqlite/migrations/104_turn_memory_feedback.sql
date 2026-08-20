CREATE TEMP TABLE legacy_memory_feedback AS
SELECT trace_id, COALESCE(turn_id, trace_id) AS turn_id, feedback_json, created_at
FROM memory_trace_events
WHERE json_extract(feedback_json, '$.rating') IN ('helpful', 'not_helpful', 'mixed', 'irrelevant');

CREATE TABLE memory_trace_events_next (
  trace_id TEXT PRIMARY KEY,
  session_key TEXT,
  turn_id TEXT,
  phase TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  request_json TEXT NOT NULL DEFAULT '{}',
  result_count INTEGER,
  selected_record_ids_json TEXT NOT NULL DEFAULT '[]',
  skipped_reason TEXT,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'local-owner',
  source_agent_id TEXT
);

INSERT INTO memory_trace_events_next
SELECT trace_id, session_key, turn_id, phase, provider_id, request_json,
       result_count, selected_record_ids_json, skipped_reason, error,
       duration_ms, created_at, user_id, source_agent_id
FROM memory_trace_events;

DROP TABLE memory_trace_events;
ALTER TABLE memory_trace_events_next RENAME TO memory_trace_events;

CREATE INDEX idx_memory_trace_created ON memory_trace_events(created_at DESC);
CREATE INDEX idx_memory_trace_provider_created ON memory_trace_events(provider_id, created_at DESC);
CREATE INDEX idx_memory_trace_session_created ON memory_trace_events(session_key, created_at DESC);
CREATE INDEX idx_memory_trace_user_created ON memory_trace_events(user_id, created_at DESC);
CREATE INDEX idx_memory_trace_source_agent_created ON memory_trace_events(source_agent_id, created_at DESC);
CREATE UNIQUE INDEX idx_memory_trace_turn_inject
  ON memory_trace_events(turn_id)
  WHERE phase = 'inject' AND turn_id IS NOT NULL;

CREATE TABLE memory_feedback (
  feedback_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES memory_trace_events(trace_id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  record_id TEXT REFERENCES memory_records(record_id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('response', 'record')),
  rating TEXT NOT NULL CHECK (rating IN (
    'helpful', 'not_helpful', 'mixed', 'irrelevant', 'incorrect', 'outdated', 'sensitive'
  )),
  score REAL,
  reason_code TEXT,
  note TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'evaluator', 'system')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((level = 'response' AND record_id IS NULL) OR (level = 'record' AND record_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_memory_feedback_target_source
  ON memory_feedback(trace_id, level, COALESCE(record_id, ''), source);
CREATE INDEX idx_memory_feedback_turn ON memory_feedback(turn_id, updated_at DESC);
CREATE INDEX idx_memory_feedback_record ON memory_feedback(record_id, updated_at DESC);

INSERT INTO memory_feedback (
  feedback_id, trace_id, turn_id, record_id, level, rating, score,
  reason_code, note, source, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))), trace_id, turn_id, NULL, 'response',
  json_extract(feedback_json, '$.rating'), json_extract(feedback_json, '$.score'),
  json_extract(feedback_json, '$.reason'), NULL,
  COALESCE(json_extract(feedback_json, '$.source'), 'user'),
  COALESCE(strftime('%s', json_extract(feedback_json, '$.createdAt')) * 1000, created_at),
  COALESCE(strftime('%s', json_extract(feedback_json, '$.updatedAt')) * 1000, created_at)
FROM legacy_memory_feedback;

DROP TABLE legacy_memory_feedback;
