ALTER TABLE proactive_scenarios
  ADD COLUMN context_provider_ids_json TEXT NOT NULL DEFAULT '["event_batch"]';
ALTER TABLE proactive_scenarios
  ADD COLUMN min_confidence REAL NOT NULL DEFAULT 0.65
    CHECK (min_confidence >= 0 AND min_confidence <= 1);
ALTER TABLE proactive_scenarios
  ADD COLUMN min_value_score REAL NOT NULL DEFAULT 0.6
    CHECK (min_value_score >= 0 AND min_value_score <= 1);
ALTER TABLE proactive_scenarios
  ADD COLUMN cooldown_seconds INTEGER NOT NULL DEFAULT 604800
    CHECK (cooldown_seconds >= 0);
ALTER TABLE proactive_scenarios
  ADD COLUMN max_runs_per_day INTEGER NOT NULL DEFAULT 30
    CHECK (max_runs_per_day > 0);

UPDATE proactive_scenarios
SET context_provider_ids_json = '["event_batch","connected_source","internal_objects","user_model","project_state"]'
WHERE scenario_key IN ('project_delivery_risk', 'blocked_work');

UPDATE proactive_scenarios
SET context_provider_ids_json = '["event_batch","user_model","automation_state","project_state"]',
    cooldown_seconds = 86400,
    max_runs_per_day = 20
WHERE scenario_key = 'automation_failure_impact';

UPDATE proactive_scenarios
SET context_provider_ids_json = '["event_batch","connected_source","user_model","meeting_workspace"]',
    cooldown_seconds = 86400,
    max_runs_per_day = 20
WHERE scenario_key = 'meeting_preparation';

UPDATE proactive_scenarios
SET context_provider_ids_json = '["event_batch","user_model","discussion"]',
    cooldown_seconds = 86400,
    max_runs_per_day = 20
WHERE scenario_key = 'discussion_follow_up';

CREATE TABLE proactive_scenario_versions (
  scenario_key TEXT NOT NULL,
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
  context_provider_ids_json TEXT NOT NULL,
  min_confidence REAL NOT NULL CHECK (min_confidence >= 0 AND min_confidence <= 1),
  min_value_score REAL NOT NULL CHECK (min_value_score >= 0 AND min_value_score <= 1),
  cooldown_seconds INTEGER NOT NULL CHECK (cooldown_seconds >= 0),
  max_runs_per_day INTEGER NOT NULL CHECK (max_runs_per_day > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (scenario_key, version),
  FOREIGN KEY (scenario_key) REFERENCES proactive_scenarios(scenario_key) ON DELETE CASCADE
);

INSERT INTO proactive_scenario_versions (
  scenario_key, version, title, description, base_prompt, base_template_version,
  event_types_json, condition_json, aggregation, debounce_seconds,
  max_window_seconds, context_provider_ids_json, min_confidence,
  min_value_score, cooldown_seconds, max_runs_per_day, created_at
)
SELECT
  scenario_key, version, title, description, base_prompt, base_template_version,
  event_types_json, condition_json, aggregation, debounce_seconds,
  max_window_seconds, context_provider_ids_json, min_confidence,
  min_value_score, cooldown_seconds, max_runs_per_day, updated_at
FROM proactive_scenarios;

CREATE TRIGGER proactive_scenario_version_after_insert
AFTER INSERT ON proactive_scenarios
BEGIN
  INSERT INTO proactive_scenario_versions (
    scenario_key, version, title, description, base_prompt, base_template_version,
    event_types_json, condition_json, aggregation, debounce_seconds,
    max_window_seconds, context_provider_ids_json, min_confidence,
    min_value_score, cooldown_seconds, max_runs_per_day, created_at
  ) VALUES (
    NEW.scenario_key, NEW.version, NEW.title, NEW.description, NEW.base_prompt,
    NEW.base_template_version, NEW.event_types_json, NEW.condition_json,
    NEW.aggregation, NEW.debounce_seconds, NEW.max_window_seconds,
    NEW.context_provider_ids_json, NEW.min_confidence, NEW.min_value_score,
    NEW.cooldown_seconds, NEW.max_runs_per_day, NEW.updated_at
  );
END;

CREATE TRIGGER proactive_scenario_contract_update_guard
BEFORE UPDATE ON proactive_scenarios
WHEN NEW.version = OLD.version AND (
  NEW.title IS NOT OLD.title
  OR NEW.description IS NOT OLD.description
  OR NEW.base_prompt IS NOT OLD.base_prompt
  OR NEW.base_template_version IS NOT OLD.base_template_version
  OR NEW.event_types_json IS NOT OLD.event_types_json
  OR NEW.condition_json IS NOT OLD.condition_json
  OR NEW.aggregation IS NOT OLD.aggregation
  OR NEW.debounce_seconds IS NOT OLD.debounce_seconds
  OR NEW.max_window_seconds IS NOT OLD.max_window_seconds
  OR NEW.context_provider_ids_json IS NOT OLD.context_provider_ids_json
  OR NEW.min_confidence IS NOT OLD.min_confidence
  OR NEW.min_value_score IS NOT OLD.min_value_score
  OR NEW.cooldown_seconds IS NOT OLD.cooldown_seconds
  OR NEW.max_runs_per_day IS NOT OLD.max_runs_per_day
)
BEGIN
  SELECT RAISE(ABORT, 'proactive scenario contract changes require a new version');
END;

CREATE TRIGGER proactive_scenario_version_after_update
AFTER UPDATE OF version ON proactive_scenarios
WHEN NEW.version <> OLD.version
BEGIN
  INSERT INTO proactive_scenario_versions (
    scenario_key, version, title, description, base_prompt, base_template_version,
    event_types_json, condition_json, aggregation, debounce_seconds,
    max_window_seconds, context_provider_ids_json, min_confidence,
    min_value_score, cooldown_seconds, max_runs_per_day, created_at
  ) VALUES (
    NEW.scenario_key, NEW.version, NEW.title, NEW.description, NEW.base_prompt,
    NEW.base_template_version, NEW.event_types_json, NEW.condition_json,
    NEW.aggregation, NEW.debounce_seconds, NEW.max_window_seconds,
    NEW.context_provider_ids_json, NEW.min_confidence, NEW.min_value_score,
    NEW.cooldown_seconds, NEW.max_runs_per_day, NEW.updated_at
  );
END;

CREATE TRIGGER proactive_scenario_versions_immutable_update
BEFORE UPDATE ON proactive_scenario_versions
BEGIN
  SELECT RAISE(ABORT, 'proactive scenario versions are immutable');
END;

CREATE TRIGGER proactive_scenario_versions_immutable_delete
BEFORE DELETE ON proactive_scenario_versions
BEGIN
  SELECT RAISE(ABORT, 'proactive scenario versions are immutable');
END;
