-- Personal thinking preferences belong to the dedicated conversation, not its Agent.
INSERT INTO session_config (conversation_id, thinking_level, updated_at)
SELECT s.conversation_id, json_extract(a.overrides_json, '$.runtime.thinkingLevel'),
       MAX(a.updated_at, s.updated_at)
FROM sessions s JOIN agents a ON a.id = s.agent_id
WHERE json_extract(s.custom_data_json, '$.personalAgent') = 1
  AND json_type(a.overrides_json, '$.runtime.thinkingLevel') = 'text'
ON CONFLICT(conversation_id) DO UPDATE SET
  thinking_level = COALESCE(session_config.thinking_level, excluded.thinking_level),
  updated_at = CASE WHEN session_config.thinking_level IS NULL
    THEN MAX(session_config.updated_at + 1, excluded.updated_at) ELSE session_config.updated_at END;

UPDATE agents SET
  overrides_json = json_remove(overrides_json, '$.runtime.thinkingLevel'),
  revision = revision + 1,
  updated_at = MAX(updated_at + 1, CAST(unixepoch('subsec') * 1000 AS INTEGER))
WHERE id IN (SELECT agent_id FROM sessions WHERE json_extract(custom_data_json, '$.personalAgent') = 1)
  AND json_type(overrides_json, '$.runtime.thinkingLevel') IS NOT NULL;

UPDATE agent_catalog_settings SET revision = revision + 1,
  updated_at = MAX(updated_at + 1, CAST(unixepoch('subsec') * 1000 AS INTEGER))
WHERE singleton_id = 1 AND changes() > 0;
