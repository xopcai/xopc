ALTER TABLE session_config ADD COLUMN action_approval_mode TEXT CHECK (action_approval_mode IN ('ask', 'full'));
