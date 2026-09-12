CREATE TABLE proactive_preferences (
  workspace_id TEXT PRIMARY KEY,
  preferences_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE proactive_subscription_settings (
  subscription_id TEXT PRIMARY KEY REFERENCES proactive_scenario_subscriptions(subscription_id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE proactive_schedule_state (
  subscription_id TEXT PRIMARY KEY REFERENCES proactive_scenario_subscriptions(subscription_id) ON DELETE CASCADE,
  next_due_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_fingerprint TEXT
);
CREATE TABLE proactive_notification_budget (
  dedupe_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  local_day TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX proactive_budget_day ON proactive_notification_budget(workspace_id, local_day);
ALTER TABLE proactive_runs ADD COLUMN outcome_reason TEXT;
ALTER TABLE proactive_runs ADD COLUMN policy_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proactive_inbox_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE proactive_inbox_items ADD COLUMN notification_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE proactive_inbox_items ADD COLUMN expires_at TEXT;
CREATE TABLE proactive_card_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  inbox_item_id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER proactive_card_created AFTER INSERT ON proactive_inbox_items BEGIN
  INSERT INTO proactive_card_changes(inbox_item_id, workspace_id)
    SELECT NEW.inbox_item_id, s.workspace_id FROM proactive_insights x JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE x.insight_id = NEW.insight_id;
END;
CREATE TRIGGER proactive_card_updated AFTER UPDATE ON proactive_inbox_items
WHEN NEW.revision = OLD.revision BEGIN
  UPDATE proactive_inbox_items SET revision = OLD.revision + 1 WHERE inbox_item_id = NEW.inbox_item_id;
  INSERT INTO proactive_card_changes(inbox_item_id, workspace_id)
    SELECT NEW.inbox_item_id, s.workspace_id FROM proactive_insights x JOIN proactive_scenario_subscriptions s USING(subscription_id) WHERE x.insight_id = NEW.insight_id;
END;
CREATE TRIGGER proactive_card_deleted AFTER DELETE ON proactive_inbox_items BEGIN
  INSERT INTO proactive_card_changes(inbox_item_id, workspace_id, deleted)
    SELECT OLD.inbox_item_id, workspace_id, 1 FROM proactive_card_changes WHERE inbox_item_id = OLD.inbox_item_id ORDER BY sequence DESC LIMIT 1;
END;
CREATE TRIGGER proactive_insight_card_updated AFTER UPDATE OF title, summary, decision_json, action_status, action_result_json, action_error ON proactive_insights BEGIN
  UPDATE proactive_inbox_items SET updated_at = NEW.action_updated_at WHERE insight_id = NEW.insight_id AND NEW.action_updated_at IS NOT NULL;
END;
CREATE TABLE proactive_card_actions (
  idempotency_key TEXT PRIMARY KEY,
  inbox_item_id TEXT NOT NULL REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL
);

INSERT INTO proactive_card_changes(inbox_item_id, workspace_id)
  SELECT i.inbox_item_id, s.workspace_id FROM proactive_inbox_items i JOIN proactive_insights x USING(insight_id) JOIN proactive_scenario_subscriptions s USING(subscription_id);

ALTER TABLE proactive_runs ADD COLUMN subscription_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proactive_runs ADD COLUMN policy_snapshot_json TEXT;

CREATE TRIGGER proactive_subscription_enabled_changed AFTER UPDATE OF enabled ON proactive_scenario_subscriptions
WHEN NEW.enabled <> OLD.enabled BEGIN
  UPDATE proactive_subscription_settings SET revision = revision + 1 WHERE subscription_id = NEW.subscription_id;
END;
