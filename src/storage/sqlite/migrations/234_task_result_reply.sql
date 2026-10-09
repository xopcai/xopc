-- Keep artifact delivery and final prose in one durable outbox with independent progress.
ALTER TABLE task_result_deliveries ADD COLUMN reply_payload_json TEXT;
ALTER TABLE task_result_deliveries ADD COLUMN reply_status TEXT CHECK(reply_status IN ('pending','generating','ready','delivered','stale'));
ALTER TABLE task_result_deliveries ADD COLUMN reply_lease_token TEXT;
ALTER TABLE task_result_deliveries ADD COLUMN reply_lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_result_deliveries ADD COLUMN reply_text TEXT;
ALTER TABLE task_result_deliveries ADD COLUMN reply_draft_transcript_id TEXT;
ALTER TABLE task_result_deliveries ADD COLUMN reply_message_entry_id TEXT;
ALTER TABLE task_result_deliveries ADD COLUMN reply_notified_at INTEGER;
ALTER TABLE task_result_deliveries ADD COLUMN reply_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_result_deliveries ADD COLUMN reply_next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_result_deliveries ADD COLUMN reply_last_error TEXT;

CREATE INDEX idx_task_result_reply_pending ON task_result_deliveries(reply_status, reply_next_attempt_at, reply_lease_until);
