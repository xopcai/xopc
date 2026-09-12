ALTER TABLE proactive_inbox_items ADD COLUMN withdrawn_at TEXT;
ALTER TABLE proactive_inbox_items ADD COLUMN correlation_key TEXT;
CREATE INDEX proactive_card_correlation ON proactive_inbox_items(correlation_key);
CREATE TABLE proactive_presence (
  workspace_id TEXT NOT NULL, client_id TEXT NOT NULL, surface TEXT NOT NULL,
  expires_at INTEGER NOT NULL, PRIMARY KEY(workspace_id, client_id)
);
CREATE TABLE proactive_digest_queue (
  inbox_item_id TEXT PRIMARY KEY REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL, notification_revision INTEGER NOT NULL,
  mode TEXT NOT NULL, due_at TEXT NOT NULL, consumed_at TEXT
);
CREATE INDEX proactive_digest_due ON proactive_digest_queue(consumed_at, due_at);
CREATE TABLE proactive_digests (
  digest_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
  created_at TEXT NOT NULL, notification_id TEXT, UNIQUE(workspace_id, occurrence_key)
);
CREATE TABLE proactive_digest_members (
  digest_id TEXT NOT NULL REFERENCES proactive_digests(digest_id) ON DELETE CASCADE,
  inbox_item_id TEXT NOT NULL REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE,
  notification_revision INTEGER NOT NULL, PRIMARY KEY(digest_id, inbox_item_id)
);
CREATE TABLE proactive_channel_deliveries (
  notification_id TEXT PRIMARY KEY REFERENCES notification_events(event_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL, target_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL, lease_until INTEGER, provider_message_id TEXT, last_error TEXT
);
CREATE TABLE proactive_preview_runs (
  id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, created_at TEXT NOT NULL,
  completed_at TEXT, status TEXT NOT NULL, error TEXT
);
CREATE TABLE proactive_delivery_decisions (
  notification_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE proactive_card_review_state (
  inbox_item_id TEXT PRIMARY KEY REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL
);
CREATE TABLE proactive_workflow_links (
  inbox_item_id TEXT PRIMARY KEY REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL, agent_id TEXT NOT NULL, attempt_key TEXT NOT NULL,
  run_id TEXT, session_key TEXT, status TEXT NOT NULL, lease_until INTEGER, error TEXT
);
CREATE TABLE proactive_push_probes (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, opened_at INTEGER, error TEXT
);
ALTER TABLE proactive_runs ADD COLUMN input_tokens INTEGER;
ALTER TABLE proactive_runs ADD COLUMN output_tokens INTEGER;
ALTER TABLE proactive_runs ADD COLUMN estimated_cost_usd REAL;
