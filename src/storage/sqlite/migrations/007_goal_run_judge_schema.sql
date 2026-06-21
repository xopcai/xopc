ALTER TABLE goal_runs ADD COLUMN confidence REAL;
ALTER TABLE goal_runs ADD COLUMN missing_evidence_json TEXT;
ALTER TABLE goal_runs ADD COLUMN user_question TEXT;
ALTER TABLE goal_runs ADD COLUMN completed_checklist_item_ids_json TEXT;
