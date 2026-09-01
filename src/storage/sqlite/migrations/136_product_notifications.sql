CREATE TABLE notification_devices (
  device_id             TEXT PRIMARY KEY,
  platform              TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  push_token            TEXT NOT NULL,
  push_provider         TEXT NOT NULL DEFAULT 'expo',
  enabled               INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  permissions           TEXT NOT NULL DEFAULT 'unknown' CHECK (permissions IN ('granted', 'denied', 'unknown')),
  preferences_json      TEXT NOT NULL DEFAULT '{}',
  locale                TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'zh')),
  app_version           TEXT,
  lease_expires_at      INTEGER NOT NULL,
  last_seen_at          INTEGER NOT NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

INSERT INTO notification_devices (
  device_id, platform, push_token, push_provider, enabled, permissions,
  preferences_json, locale, app_version, lease_expires_at,
  last_seen_at, created_at, updated_at
)
SELECT
  device_id, platform, push_token, push_provider, enabled, permissions,
  preferences_json, 'en', app_version,
  (unixepoch() * 1000) + 604800000,
  last_seen_at, created_at, updated_at
FROM mobile_devices;

CREATE UNIQUE INDEX idx_notification_devices_push_token
  ON notification_devices(push_provider, push_token);
CREATE INDEX idx_notification_devices_delivery
  ON notification_devices(enabled, permissions, lease_expires_at);

CREATE TABLE notification_events (
  event_id              TEXT PRIMARY KEY,
  dedupe_key            TEXT NOT NULL UNIQUE,
  event_type            TEXT NOT NULL,
  target_json           TEXT NOT NULL,
  priority              TEXT NOT NULL CHECK (priority IN ('normal', 'high')),
  title_en              TEXT NOT NULL,
  title_zh              TEXT NOT NULL,
  body_en               TEXT,
  body_zh               TEXT,
  payload_json          TEXT NOT NULL DEFAULT '{}',
  created_at            INTEGER NOT NULL
);

CREATE INDEX idx_notification_events_created
  ON notification_events(created_at, event_id);

CREATE TABLE notification_deliveries (
  event_id              TEXT NOT NULL,
  device_id             TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'delivered', 'dead')),
  attempts              INTEGER NOT NULL DEFAULT 0,
  next_attempt_at       INTEGER NOT NULL,
  provider_ticket_id    TEXT,
  last_error            TEXT,
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (event_id, device_id),
  FOREIGN KEY (event_id) REFERENCES notification_events(event_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES notification_devices(device_id) ON DELETE CASCADE
);

CREATE INDEX idx_notification_deliveries_due
  ON notification_deliveries(status, next_attempt_at);

CREATE TABLE notification_acknowledgements (
  event_id              TEXT NOT NULL,
  consumer_id           TEXT NOT NULL,
  surface               TEXT NOT NULL CHECK (surface IN ('web', 'electron', 'mobile')),
  acknowledged_at       INTEGER NOT NULL,
  PRIMARY KEY (event_id, consumer_id),
  FOREIGN KEY (event_id) REFERENCES notification_events(event_id) ON DELETE CASCADE
);

DROP TABLE mobile_activity_acknowledgements;
DROP TABLE mobile_activity_events;
DROP TABLE mobile_devices;
