CREATE TABLE proactive_scenarios (
  scenario_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  base_prompt TEXT NOT NULL,
  base_template_version INTEGER NOT NULL CHECK (base_template_version > 0),
  event_types_json TEXT NOT NULL,
  condition_json TEXT,
  aggregation TEXT NOT NULL CHECK (aggregation IN ('subject', 'project', 'workspace')),
  debounce_seconds INTEGER NOT NULL CHECK (debounce_seconds >= 0),
  max_window_seconds INTEGER NOT NULL CHECK (max_window_seconds > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE proactive_scenario_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  scenario_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('workspace', 'project')),
  scope_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  active_prompt_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scenario_key, workspace_id, scope_kind, scope_id),
  FOREIGN KEY (scenario_key) REFERENCES proactive_scenarios(scenario_key) ON DELETE CASCADE
);

CREATE TABLE proactive_prompt_revisions (
  revision_id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  base_template_version INTEGER NOT NULL CHECK (base_template_version > 0),
  user_instructions TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (subscription_id, revision),
  FOREIGN KEY (subscription_id) REFERENCES proactive_scenario_subscriptions(subscription_id) ON DELETE CASCADE
);

CREATE INDEX idx_proactive_subscriptions_enabled
  ON proactive_scenario_subscriptions(enabled, workspace_id, scenario_key);
CREATE INDEX idx_proactive_prompt_revisions_subscription
  ON proactive_prompt_revisions(subscription_id, status, revision DESC);

ALTER TABLE proactive_signal_batches ADD COLUMN subscription_id TEXT NOT NULL DEFAULT '';
DROP INDEX idx_proactive_collecting_batch;
CREATE UNIQUE INDEX idx_proactive_collecting_batch
  ON proactive_signal_batches(subscription_id, scenario_key, aggregation_key)
  WHERE status = 'collecting';

INSERT INTO proactive_scenarios VALUES
  ('project_delivery_risk', 1, 'Project delivery risk', 'Detect credible risks to a project commitment.',
   'Identify material changes that create supported schedule, scope, dependency, capacity, or ownership risk. Ignore routine activity and unsupported absence-of-activity claims.',
   1, '["project.updated.v1","work_item.status_changed.v1","work_item.updated.v1"]', NULL,
   'project', 300, 1800, datetime('now'), datetime('now')),
  ('blocked_work', 1, 'Blocked work', 'Find work that needs a decision, dependency, or owner intervention.',
   'Confirm that work is truly blocked, identify the blocking object and downstream impact, then propose the smallest supported intervention.',
   1, '["work_item.status_changed.v1","work_item.updated.v1"]',
   '{"op":"any","conditions":[{"op":"eq","field":"payload.after.status","value":"blocked"},{"op":"changed","field":"payload.dependencyIds"}]}',
   'project', 180, 900, datetime('now'), datetime('now')),
  ('automation_failure_impact', 1, 'Automation failure impact', 'Explain whether a terminal automation failure affects user outcomes.',
   'Classify the failure, distinguish completed from incomplete work, connect it to a user outcome, and request only supported recovery decisions. Do not repeat raw stack traces.',
   1, '["automation.run_failed.v1"]', NULL,
   'subject', 60, 300, datetime('now'), datetime('now'));
