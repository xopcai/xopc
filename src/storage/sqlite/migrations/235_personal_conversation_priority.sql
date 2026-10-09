-- Conversation priority is independent of Task cancellation and artifact delivery.
ALTER TABLE session_inputs ADD COLUMN interrupt_requested INTEGER NOT NULL DEFAULT 0 CHECK(interrupt_requested IN (0, 1));
ALTER TABLE task_result_deliveries ADD COLUMN reply_context_revision INTEGER;
