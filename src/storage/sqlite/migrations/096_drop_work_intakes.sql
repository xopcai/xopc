DROP TABLE IF EXISTS work_intakes;

ALTER TABLE outcome_execution_state ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX idx_outcome_execution_request
  ON outcome_execution_state(request_id)
  WHERE request_id IS NOT NULL;
