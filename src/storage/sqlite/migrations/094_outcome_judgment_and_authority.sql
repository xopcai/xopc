ALTER TABLE execution_receipts ADD COLUMN judgment_json TEXT;
ALTER TABLE outcome_execution_state
  ADD COLUMN approved_boundaries_json TEXT NOT NULL DEFAULT '[]';
