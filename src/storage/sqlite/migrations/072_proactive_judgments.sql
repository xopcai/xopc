ALTER TABLE proactive_insights ADD COLUMN work_done TEXT NOT NULL DEFAULT '';
ALTER TABLE proactive_insights ADD COLUMN decision_json TEXT;

CREATE TABLE proactive_instruction_feedback (
  instruction_id TEXT PRIMARY KEY,
  inbox_item_id TEXT NOT NULL,
  prompt_revision_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (inbox_item_id) REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE,
  FOREIGN KEY (prompt_revision_id) REFERENCES proactive_prompt_revisions(revision_id)
);

CREATE INDEX idx_proactive_instruction_item ON proactive_instruction_feedback(inbox_item_id, created_at DESC);
