UPDATE memory_records
SET provider_id = 'local'
WHERE provider_id IN ('personal-context', 'connected-understanding')
  AND EXISTS (
    SELECT 1
    FROM json_each(memory_records.tags_json)
    WHERE json_each.value = 'user-understanding'
  );

DELETE FROM memory_records_fts;

INSERT INTO memory_records_fts (
  content, record_id, provider_id, kind, user_id, source_agent_id, workspace_id
)
SELECT
  content, record_id, provider_id, kind, user_id, source_agent_id, workspace_id
FROM memory_records
WHERE trim(content) <> '';
