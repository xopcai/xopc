INSERT OR IGNORE INTO proactive_scenario_subscriptions (
  subscription_id,
  scenario_key,
  workspace_id,
  scope_kind,
  scope_id,
  enabled,
  created_at,
  updated_at
) VALUES
  ('default-project-delivery-risk', 'project_delivery_risk', 'default', 'workspace', 'default', 1, datetime('now'), datetime('now')),
  ('default-blocked-work', 'blocked_work', 'default', 'workspace', 'default', 1, datetime('now'), datetime('now')),
  ('default-automation-failure-impact', 'automation_failure_impact', 'default', 'workspace', 'default', 1, datetime('now'), datetime('now'));
