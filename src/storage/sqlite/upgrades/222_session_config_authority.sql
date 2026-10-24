INSERT INTO session_config (
  conversation_id, thinking_level, verbose_level, updated_at
)
SELECT conversation_id, thinking_level, verbose_level, updated_at
FROM sessions
WHERE thinking_level IS NOT NULL OR verbose_level IS NOT NULL
ON CONFLICT(conversation_id) DO UPDATE SET
  thinking_level = COALESCE(session_config.thinking_level, excluded.thinking_level),
  verbose_level = COALESCE(session_config.verbose_level, excluded.verbose_level),
  updated_at = MAX(session_config.updated_at, excluded.updated_at);

ALTER TABLE sessions DROP COLUMN thinking_level;
ALTER TABLE sessions DROP COLUMN verbose_level;
