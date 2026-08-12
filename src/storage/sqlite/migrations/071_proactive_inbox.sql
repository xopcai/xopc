CREATE TABLE proactive_inbox_items (
  inbox_item_id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('unread', 'read', 'snoozed', 'resolved')),
  snoozed_until TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (insight_id) REFERENCES proactive_insights(insight_id) ON DELETE CASCADE
);

CREATE TABLE proactive_decisions (
  decision_id TEXT PRIMARY KEY,
  inbox_item_id TEXT NOT NULL,
  choice TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (inbox_item_id) REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE
);

CREATE TABLE proactive_delivery_outbox (
  delivery_id TEXT PRIMARY KEY,
  inbox_item_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivering', 'delivered', 'retryable', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_attempt_at TEXT NOT NULL,
  lease_expires_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (inbox_item_id) REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE
);

CREATE TABLE proactive_feedback (
  feedback_id TEXT PRIMARY KEY,
  inbox_item_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('useful', 'not_useful')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (inbox_item_id) REFERENCES proactive_inbox_items(inbox_item_id) ON DELETE CASCADE
);

CREATE INDEX idx_proactive_inbox_status ON proactive_inbox_items(status, updated_at DESC);
CREATE INDEX idx_proactive_outbox_ready ON proactive_delivery_outbox(status, next_attempt_at);
