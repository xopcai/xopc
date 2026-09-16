UPDATE proactive_preferences SET preferences_json = json_remove(json_set(preferences_json,
  '$.checksPaused', json(CASE WHEN json_extract(preferences_json, '$.level') = 'off' THEN 'true' ELSE 'false' END),
  '$.checksPausedUntil', json_extract(preferences_json, '$.pausedUntil'),
  '$.level', CASE WHEN json_extract(preferences_json, '$.level') = 'off' THEN 'balanced' ELSE COALESCE(json_extract(preferences_json, '$.level'), 'balanced') END), '$.pausedUntil');
UPDATE proactive_scenario_subscriptions SET enabled = 0 WHERE subscription_id IN
  (SELECT subscription_id FROM proactive_subscription_settings WHERE json_extract(settings_json, '$.level') = 'off');
UPDATE proactive_subscription_settings SET settings_json = json_set(settings_json, '$.level', NULL)
  WHERE json_extract(settings_json, '$.level') = 'off';
CREATE TABLE heartbeat_checks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  detail TEXT,
  content TEXT,
  target TEXT,
  chat_id TEXT,
  fingerprint TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'none',
  next_attempt_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX heartbeat_checks_recent ON heartbeat_checks(workspace_id, started_at DESC);
CREATE INDEX heartbeat_checks_pending ON heartbeat_checks(delivery_status, next_attempt_at);
