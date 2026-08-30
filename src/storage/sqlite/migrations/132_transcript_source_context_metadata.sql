UPDATE transcript_entries AS entry
SET payload_json = json_set(
  entry.payload_json,
  '$.metadata.sourceContexts',
  json((
    SELECT input.context_refs_json
    FROM session_inputs AS input
    JOIN transcripts AS transcript
      ON transcript.session_id = entry.session_id
     AND transcript.session_key = input.session_key
    WHERE input.run_id = json_extract(entry.payload_json, '$.turnId')
      AND input.context_refs_json IS NOT NULL
      AND json_valid(input.context_refs_json)
      AND json_type(input.context_refs_json) = 'array'
    LIMIT 1
  ))
)
WHERE entry.role = 'user'
  AND json_type(entry.payload_json, '$.metadata.sourceContexts') IS NULL
  AND (
    json_type(entry.payload_json, '$.metadata') IS NULL
    OR json_type(entry.payload_json, '$.metadata') = 'object'
  )
  AND EXISTS (
    SELECT 1
    FROM session_inputs AS input
    JOIN transcripts AS transcript
      ON transcript.session_id = entry.session_id
     AND transcript.session_key = input.session_key
    WHERE input.run_id = json_extract(entry.payload_json, '$.turnId')
      AND input.context_refs_json IS NOT NULL
      AND json_valid(input.context_refs_json)
      AND json_type(input.context_refs_json) = 'array'
  );
