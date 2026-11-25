CREATE INDEX idx_rsi_adopted_skill_identity
  ON rsi_capability_candidates(target_id, content_hash)
  WHERE artifact_kind = 'skill' AND adopted_version IS NOT NULL;

CREATE TABLE rsi_skill_invocations (
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES rsi_capability_candidates(id) ON DELETE CASCADE,
  task_run_id TEXT,
  outcome TEXT CHECK (outcome IN ('verified_success', 'failure', 'human_edited', 'unverified', 'ignored')),
  PRIMARY KEY (conversation_id, run_id, candidate_id)
);

CREATE UNIQUE INDEX idx_rsi_skill_invocations_task
  ON rsi_skill_invocations(task_run_id, candidate_id) WHERE task_run_id IS NOT NULL;
