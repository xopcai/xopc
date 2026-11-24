ALTER TABLE personal_attention_threads ADD COLUMN follow_up_mode TEXT NOT NULL DEFAULT 'recurring' CHECK(follow_up_mode IN ('recurring','one_shot'));
ALTER TABLE personal_attention_threads ADD COLUMN wait_id TEXT;
ALTER TABLE personal_attention_threads ADD COLUMN destination TEXT CHECK(destination IS NULL OR destination IN ('personal','workbench'));
ALTER TABLE personal_attention_threads ADD COLUMN check_at INTEGER;
ALTER TABLE personal_attention_threads ADD COLUMN valid_until INTEGER;
ALTER TABLE personal_attention_threads ADD COLUMN timezone TEXT;
ALTER TABLE personal_attention_threads ADD COLUMN contract_key TEXT;
ALTER TABLE personal_attention_threads ADD COLUMN session_input_id TEXT;
ALTER TABLE personal_attention_threads ADD COLUMN last_checked_at INTEGER;
ALTER TABLE personal_attention_threads ADD COLUMN last_check_error TEXT;
ALTER TABLE personal_attention_threads ADD COLUMN terminal_reason TEXT CHECK(terminal_reason IS NULL OR terminal_reason IN ('delivered','resolved_before_check','stopped','expired','task_closed','task_deleted','access_revoked','conversation_reset'));

ALTER TABLE personal_outreach ADD COLUMN destination TEXT NOT NULL DEFAULT 'personal' CHECK(destination IN ('personal','workbench'));
ALTER TABLE personal_outreach ADD COLUMN acknowledged_at INTEGER;

CREATE UNIQUE INDEX personal_one_shot_active_contract
  ON personal_attention_threads(owner_id, contract_key)
  WHERE follow_up_mode = 'one_shot' AND status = 'active' AND contract_key IS NOT NULL;

CREATE UNIQUE INDEX personal_one_shot_session_input
  ON personal_attention_threads(owner_id, session_input_id)
  WHERE follow_up_mode = 'one_shot' AND session_input_id IS NOT NULL;

CREATE INDEX personal_one_shot_task_wait
  ON personal_attention_threads(task_id, wait_id, status)
  WHERE follow_up_mode = 'one_shot';
