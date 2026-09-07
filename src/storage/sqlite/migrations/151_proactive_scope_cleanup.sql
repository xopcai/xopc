DELETE FROM proactive_scenario_subscriptions
WHERE subscription_id IN (
  'default-project-delivery-risk',
  'default-blocked-work',
  'default-automation-failure-impact'
);
