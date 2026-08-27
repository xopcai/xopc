ALTER TABLE automations ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'new_session'
  CHECK (conversation_mode IN ('new_session', 'continuous'));
ALTER TABLE automations ADD COLUMN notification_policy TEXT NOT NULL DEFAULT 'attention'
  CHECK (notification_policy IN ('attention', 'all', 'none'));
ALTER TABLE automations ADD COLUMN completion_webhook_url TEXT;

UPDATE automations
SET completion_webhook_url = json_extract(after_run_json, '$.url')
WHERE json_extract(after_run_json, '$.kind') = 'webhook';

ALTER TABLE automations DROP COLUMN after_run_json;

UPDATE automation_runs
SET current_phase = 'completion_hook'
WHERE current_phase = 'after_run';

UPDATE automation_run_events
SET type = replace(type, 'after_run.', 'completion_hook.'),
    message = replace(message, 'After-run webhook', 'Completion webhook')
WHERE type LIKE 'after_run.%';

ALTER TABLE automation_runs ADD COLUMN read_at_ms INTEGER;
CREATE INDEX IF NOT EXISTS idx_automation_runs_unread_created
  ON automation_runs(read_at_ms, created_at_ms DESC);
