INSERT OR IGNORE INTO proactive_scenarios (
  scenario_key,
  version,
  title,
  description,
  base_prompt,
  base_template_version,
  event_types_json,
  condition_json,
  aggregation,
  debounce_seconds,
  max_window_seconds,
  created_at,
  updated_at
) VALUES (
  'discussion_follow_up',
  1,
  'Discussion follow-up',
  'Identify useful next steps after a user-reviewed discussion.',
  'Assess whether the reviewed discussion needs a concise follow-up suggestion. Prioritize missing owners, missing dates, unresolved questions, and material risks. Use only authorized context, never invent commitments or people, and never perform external actions automatically.',
  1,
  '["discussion.completed.v1"]',
  NULL,
  'subject',
  60,
  300,
  datetime('now'),
  datetime('now')
);
