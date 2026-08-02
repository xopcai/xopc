ALTER TABLE proactive_insights ADD COLUMN value_score REAL NOT NULL DEFAULT 0
  CHECK (value_score >= 0 AND value_score <= 1);
ALTER TABLE proactive_insights ADD COLUMN value_reasons_json TEXT NOT NULL DEFAULT '[]';
