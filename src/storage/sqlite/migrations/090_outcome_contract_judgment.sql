ALTER TABLE outcome_contracts ADD COLUMN assumptions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE outcome_contracts ADD COLUMN risks_json TEXT NOT NULL DEFAULT '[]';
