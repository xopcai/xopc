CREATE TABLE automation_run_requests (
  run_id TEXT PRIMARY KEY,
  automation_json TEXT NOT NULL CHECK (json_valid(automation_json))
);

-- Freeze the configuration previously used to resume pre-upgrade queued runs.
-- Remove only top-level optional fields; merge-patch would erase null workflow inputs.
INSERT INTO automation_run_requests (run_id, automation_json)
SELECT r.run_id, json_remove(json_object(
  'id', a.automation_id, 'name', r.automation_name, 'description', a.description,
  'projectId', a.project_id, 'enabled', json(CASE WHEN a.enabled = 1 THEN 'true' ELSE 'false' END),
  'trigger', json(r.trigger_snapshot_json), 'action', json(r.action_snapshot_json),
  'safety', json(a.safety_json), 'conversationMode', a.conversation_mode,
  'notificationPolicy', a.notification_policy, 'completionWebhookUrl', a.completion_webhook_url,
  'reliability', json(a.reliability_json), 'state', json(a.state_json),
  'createdAtMs', a.created_at_ms, 'updatedAtMs', a.updated_at_ms
),
  CASE WHEN a.description IS NULL THEN '$.description' ELSE '$.__absent' END,
  CASE WHEN a.project_id IS NULL THEN '$.projectId' ELSE '$.__absent' END,
  CASE WHEN a.safety_json IS NULL THEN '$.safety' ELSE '$.__absent' END,
  CASE WHEN a.completion_webhook_url IS NULL THEN '$.completionWebhookUrl' ELSE '$.__absent' END,
  CASE WHEN a.reliability_json IS NULL THEN '$.reliability' ELSE '$.__absent' END
) FROM automation_runs r JOIN automations a ON a.automation_id = r.automation_id WHERE r.status = 'queued';
