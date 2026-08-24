ALTER TABLE proactive_insights ADD COLUMN proposed_action_json TEXT;
ALTER TABLE proactive_insights ADD COLUMN disposition TEXT
  CHECK (disposition IN ('record_silently', 'show_in_work', 'request_approval', 'auto_execute'));
ALTER TABLE proactive_insights ADD COLUMN disposition_reason TEXT;
ALTER TABLE proactive_insights ADD COLUMN action_status TEXT
  CHECK (action_status IN ('not_authorized', 'approval_required', 'pending', 'executing', 'completed', 'rejected', 'failed'));
ALTER TABLE proactive_insights ADD COLUMN action_result_json TEXT;
ALTER TABLE proactive_insights ADD COLUMN action_error TEXT;
ALTER TABLE proactive_insights ADD COLUMN disposition_at TEXT;
ALTER TABLE proactive_insights ADD COLUMN action_updated_at TEXT;

CREATE INDEX idx_proactive_insights_action_status
  ON proactive_insights(action_status, created_at);
