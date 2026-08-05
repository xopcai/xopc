CREATE TEMP TABLE xopc_runtime_transcript_cleanup_sessions (
  session_id TEXT PRIMARY KEY
);

INSERT INTO xopc_runtime_transcript_cleanup_sessions (session_id)
SELECT DISTINCT session_id
FROM transcript_entries
WHERE entry_kind = 'message'
  AND json_extract(payload_json, '$.droppable') = 1;

DELETE FROM transcript_fts
WHERE entry_id IN (
  SELECT entry_id
  FROM transcript_entries
  WHERE session_id IN (SELECT session_id FROM xopc_runtime_transcript_cleanup_sessions)
    AND (
      json_extract(payload_json, '$.droppable') = 1
      OR json_extract(payload_json, '$.type') = 'compaction'
    )
);

DELETE FROM transcript_entries
WHERE session_id IN (SELECT session_id FROM xopc_runtime_transcript_cleanup_sessions)
  AND (
    json_extract(payload_json, '$.droppable') = 1
    OR json_extract(payload_json, '$.type') = 'compaction'
  );

UPDATE sessions
SET
  message_count = (
    SELECT COUNT(*)
    FROM transcript_entries e
    WHERE e.session_id = sessions.session_id
      AND e.entry_kind = 'message'
  ),
  estimated_tokens = (
    SELECT COALESCE(SUM((length(COALESCE(json_extract(e.payload_json, '$.content'), '')) + 3) / 4), 0)
    FROM transcript_entries e
    WHERE e.session_id = sessions.session_id
      AND e.entry_kind = 'message'
  )
WHERE session_id IN (SELECT session_id FROM xopc_runtime_transcript_cleanup_sessions);

DROP TABLE xopc_runtime_transcript_cleanup_sessions;
