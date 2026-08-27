DELETE FROM transcript_fts
WHERE entry_id IN (
  SELECT entry_id
  FROM transcript_entries
  WHERE entry_kind = 'compaction'
);

DELETE FROM transcript_entries
WHERE entry_kind = 'compaction';

UPDATE sessions
SET
  compacted_count = 0,
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
  );
