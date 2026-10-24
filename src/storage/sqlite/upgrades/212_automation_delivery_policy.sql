ALTER TABLE automations ADD COLUMN delivery_json TEXT;

UPDATE automations
SET delivery_json = json_patch(
  json_object('notificationPolicy', notification_policy),
  CASE WHEN completion_webhook_url IS NULL
    THEN json('{}')
    ELSE json_object('completionWebhookUrl', completion_webhook_url)
  END
);

UPDATE automation_run_requests
SET automation_json = json_remove(
  json_set(
    automation_json,
    '$.delivery',
    json_patch(
      json_object('notificationPolicy', COALESCE(json_extract(automation_json, '$.notificationPolicy'), 'attention')),
      CASE WHEN json_extract(automation_json, '$.completionWebhookUrl') IS NULL
        THEN json('{}')
        ELSE json_object('completionWebhookUrl', json_extract(automation_json, '$.completionWebhookUrl'))
      END
    )
  ),
  '$.notificationPolicy',
  '$.completionWebhookUrl'
);

ALTER TABLE automations DROP COLUMN notification_policy;
ALTER TABLE automations DROP COLUMN completion_webhook_url;
