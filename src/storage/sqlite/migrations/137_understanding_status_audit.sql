CREATE TABLE understanding_status_events (
  event_id TEXT PRIMARY KEY,
  understanding_id TEXT NOT NULL REFERENCES user_understandings(understanding_id) ON DELETE CASCADE,
  from_status TEXT CHECK (from_status IS NULL OR from_status IN (
    'candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected'
  )),
  to_status TEXT NOT NULL CHECK (to_status IN (
    'candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'runtime', 'migration')),
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_understanding_status_events_item
  ON understanding_status_events(understanding_id, created_at DESC);

INSERT INTO understanding_status_events (
  event_id, understanding_id, from_status, to_status, actor_type, source, created_at
)
SELECT
  lower(hex(randomblob(16))), understanding_id, NULL, status, 'migration', 'status-audit-baseline', updated_at
FROM user_understandings;

INSERT INTO understanding_status_events (
  event_id, understanding_id, from_status, to_status, actor_type, source, created_at
)
SELECT
  lower(hex(randomblob(16))), u.understanding_id, u.status, 'needs_review', 'migration',
  'repair-untrusted-portrait-v1', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM user_understandings u
JOIN user_understanding_versions v ON v.version_id = u.current_version_id
WHERE u.status = 'active'
  AND (
    u.canonical_key LIKE 'connected:%'
    OR u.canonical_key LIKE 'connected-semantic:%'
    OR (u.canonical_key LIKE 'work-discovery:%' AND v.created_by <> 'user')
    OR EXISTS (
      SELECT 1
      FROM understanding_evidence_links l
      JOIN context_evidence e ON e.evidence_id = l.evidence_id
      WHERE l.version_id = u.current_version_id
        AND e.extractor_id IN ('connector-structural', 'connector-semantic', 'explicit-command')
    )
    OR (u.kind = 'task_lesson' AND length(v.statement) > 240)
    OR (u.kind = 'boundary' AND (
      v.statement LIKE '%不要再问%'
      OR v.statement LIKE '%直接执行%'
      OR lower(v.statement) LIKE '%do not ask%'
      OR lower(v.statement) LIKE '%just do it%'
    ))
  );

UPDATE user_understandings
SET status = 'needs_review',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE understanding_id IN (
  SELECT understanding_id
  FROM understanding_status_events
  WHERE source = 'repair-untrusted-portrait-v1'
);

UPDATE context_temporal_assertions
SET status = 'candidate',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE object_type = 'understanding'
  AND object_id IN (
    SELECT understanding_id
    FROM understanding_status_events
    WHERE source = 'repair-untrusted-portrait-v1'
  );
