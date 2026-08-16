ALTER TABLE task_outcomes ADD COLUMN completion_verdict TEXT
  CHECK (completion_verdict IN ('achieved', 'partial', 'not_achieved'));
ALTER TABLE task_outcomes ADD COLUMN completion_verdict_source TEXT
  CHECK (completion_verdict_source IN ('system', 'user'));
ALTER TABLE task_outcomes ADD COLUMN correction_text TEXT;
ALTER TABLE task_outcomes ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_outcomes ADD COLUMN projected_at INTEGER;

CREATE INDEX idx_task_outcomes_projection
  ON task_outcomes(status, projection_version, completed_at);

UPDATE task_outcomes
SET completion_verdict = CASE
      WHEN status = 'succeeded' AND verification_status = 'passed' THEN 'achieved'
      WHEN status = 'succeeded' THEN 'partial'
      ELSE 'not_achieved'
    END,
    completion_verdict_source = 'system'
WHERE status != 'running';
