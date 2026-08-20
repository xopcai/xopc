ALTER TABLE session_config
ADD COLUMN user_context_mode TEXT CHECK (user_context_mode IN ('enabled', 'off'));
