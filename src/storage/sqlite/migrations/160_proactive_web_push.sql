CREATE TABLE proactive_web_push_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);
CREATE TABLE proactive_web_push_subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  language TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE proactive_web_push_deliveries (
  notification_id TEXT NOT NULL REFERENCES notification_events(event_id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES proactive_web_push_subscriptions(id) ON DELETE CASCADE,
  inbox_item_id TEXT NOT NULL,
  notification_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  last_error TEXT,
  PRIMARY KEY(notification_id, subscription_id)
);

CREATE INDEX proactive_web_push_due_idx ON proactive_web_push_deliveries(status, next_attempt_at);
