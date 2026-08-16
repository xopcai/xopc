INSERT INTO proactive_scenarios (
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
  'meeting_preparation',
  1,
  'Meeting preparation',
  'Prepare for an upcoming meeting using authorized calendar and internal context.',
  'Assess whether the upcoming meeting needs preparation. Produce a concise brief only when it adds material value. Connect calendar facts to goals, notes, and user understanding only when the evidence explicitly supports the relationship. Never invent attendees, intent, commitments, or missing context.',
  1,
  '["connected_source.calendar_window.v1"]',
  NULL,
  'subject',
  60,
  300,
  datetime('now'),
  datetime('now')
);
