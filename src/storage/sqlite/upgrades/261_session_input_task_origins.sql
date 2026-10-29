-- Task dispatch, collaboration, and scheduled inputs previously shared this source.
-- Normalize durable inputs before startup recovery applies the current origin contract.
UPDATE session_inputs
SET origin_json = json_set(origin_json, '$.source', 'task'), version = version + 1
WHERE json_extract(origin_json, '$.type') = 'system'
  AND json_extract(origin_json, '$.source') = 'workflow';
