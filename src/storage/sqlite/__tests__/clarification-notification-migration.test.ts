import { DatabaseSync } from 'node:sqlite';

import { expect, it } from 'vitest';

import { applyPendingMigrations } from '../migrations/runner.js';
import { ensureSchemaMetaTable, setSchemaVersion } from '../schema-version.js';

it('backfills existing questions and preserves deliveries while adding cancellation', () => {
  const db = new DatabaseSync(':memory:');
  try {
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 238);
    db.exec(`CREATE TABLE session_clarification_waits(id TEXT PRIMARY KEY, status TEXT, data_json TEXT);
      CREATE TABLE notification_events(event_id TEXT PRIMARY KEY);
      CREATE TABLE device_push_endpoints(device_id TEXT PRIMARY KEY);
      CREATE TABLE notification_deliveries(event_id TEXT, device_id TEXT,
        status TEXT CHECK(status IN ('pending','accepted','delivered','dead')), attempts INTEGER,
        next_attempt_at INTEGER, provider_ticket_id TEXT, last_error TEXT, updated_at INTEGER,
        PRIMARY KEY(event_id, device_id));
      CREATE INDEX idx_notification_deliveries_due ON notification_deliveries(status, next_attempt_at);
      CREATE INDEX idx_notification_deliveries_device ON notification_deliveries(device_id);
      INSERT INTO session_clarification_waits VALUES ('open', 'open', '{"createdAt":123}'), ('done', 'resolved', '{"createdAt":1}');
      INSERT INTO notification_events VALUES ('event');
      INSERT INTO device_push_endpoints VALUES ('phone');
      INSERT INTO notification_deliveries VALUES ('event', 'phone', 'accepted', 2, 100, 'receipt', NULL, 90);`);
    const original = db.prepare('SELECT * FROM notification_deliveries').get();
    applyPendingMigrations(db, { targetVersion: 239 });
    expect(db.prepare('SELECT * FROM notification_deliveries').get()).toEqual(original);
    expect(db.prepare('SELECT * FROM clarification_notification_outbox').all()).toEqual([{ wait_id: 'open', status: 'pending', created_at: 123 }]);
    db.prepare("UPDATE notification_deliveries SET status = 'cancelled'").run();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_notification_deliveries_%'").all()).toHaveLength(2);
  } finally { db.close(); }
});
