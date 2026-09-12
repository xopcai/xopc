ALTER TABLE proactive_insights ADD COLUMN artifact_json TEXT;
ALTER TABLE proactive_insights ADD COLUMN artifact_edited_at TEXT;
CREATE TRIGGER proactive_artifact_updated AFTER UPDATE OF artifact_json, proposed_action_json ON proactive_insights BEGIN
  UPDATE proactive_inbox_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE insight_id = NEW.insight_id;
END;
UPDATE proactive_subscription_settings SET settings_json = json_remove(settings_json, '$.preparationWorkflowId');
DROP TABLE proactive_workflow_links;
