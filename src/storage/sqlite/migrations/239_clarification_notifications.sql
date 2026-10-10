CREATE TABLE clarification_notification_outbox (
  wait_id TEXT PRIMARY KEY REFERENCES session_clarification_waits(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'settled')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_clarification_notification_pending ON clarification_notification_outbox(status, created_at);
INSERT INTO clarification_notification_outbox(wait_id, created_at)
SELECT id, CAST(json_extract(data_json, '$.createdAt') AS INTEGER)
FROM session_clarification_waits WHERE status = 'open';

ALTER TABLE notification_deliveries RENAME TO notification_deliveries_old;
CREATE TABLE notification_deliveries (
  event_id TEXT NOT NULL REFERENCES notification_events(event_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES device_push_endpoints(device_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'delivered', 'dead', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  provider_ticket_id TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(event_id, device_id)
);
INSERT INTO notification_deliveries SELECT * FROM notification_deliveries_old;
DROP TABLE notification_deliveries_old;
CREATE INDEX idx_notification_deliveries_due ON notification_deliveries(status, next_attempt_at);
CREATE INDEX idx_notification_deliveries_device ON notification_deliveries(device_id);
