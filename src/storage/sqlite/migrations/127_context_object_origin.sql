ALTER TABLE context_run_items ADD COLUMN origin TEXT NOT NULL DEFAULT 'inferred'
  CHECK (origin IN ('told_by_user', 'observed', 'inferred', 'connected_source'));

UPDATE context_run_items SET origin = 'told_by_user' WHERE object_type IN ('profile', 'rule');
UPDATE context_run_items SET origin = 'told_by_user'
WHERE object_type = 'understanding' AND source_label = 'You told xopc';
UPDATE context_run_items SET origin = 'observed'
WHERE object_type = 'understanding' AND source_label = 'Observed across prior work';

CREATE TABLE session_config_next (
  session_key TEXT PRIMARY KEY,
  thinking_level TEXT,
  reasoning_level TEXT,
  verbose_level TEXT,
  elevated_mode TEXT,
  model_override TEXT,
  provider_override TEXT,
  working_directory_override TEXT,
  response_language TEXT,
  user_context_mode TEXT CHECK (user_context_mode IN ('enabled', 'off', 'temporary')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (session_key) REFERENCES sessions(session_key) ON DELETE CASCADE
);

INSERT INTO session_config_next (
  session_key, thinking_level, reasoning_level, verbose_level, elevated_mode,
  model_override, provider_override, working_directory_override, response_language,
  user_context_mode, updated_at
)
SELECT session_key, thinking_level, reasoning_level, verbose_level, elevated_mode,
  model_override, provider_override, working_directory_override, response_language,
  user_context_mode, updated_at
FROM session_config;

DROP TABLE session_config;
ALTER TABLE session_config_next RENAME TO session_config;
