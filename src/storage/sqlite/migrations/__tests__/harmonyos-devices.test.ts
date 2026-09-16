import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { requireNodeSqlite } from '../../../../infra/node-sqlite.js';
import { ensureSchemaMetaTable, setSchemaVersion } from '../../schema-version.js';
import { applyPendingMigrations } from '../runner.js';

const { DatabaseSync } = requireNodeSqlite();

describe('HarmonyOS device migration', () => {
  it('preserves devices and their credentials with foreign keys enabled', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      ensureSchemaMetaTable(db);
      db.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
      setSchemaVersion(db, 165);
      applyPendingMigrations(db, { targetVersion: 178 });
      db.exec(`
        INSERT INTO devices(device_id, display_name, platform, public_key_jwk, scopes_json, created_at)
          VALUES ('phone', 'Phone', 'ios', '{}', '[]', 1);
        INSERT INTO device_refresh_credentials(credential_id, device_id, token_hash, expires_at, created_at)
          VALUES ('credential', 'phone', 'hash', 999, 1);
        INSERT INTO device_access_sessions(session_id, device_id, token_hash, expires_at, created_at)
          VALUES ('session', 'phone', 'hash', 999, 1);
        INSERT INTO device_push_endpoints(device_id, platform, push_token, permissions, locale,
          lease_expires_at, last_seen_at, created_at, updated_at)
          VALUES ('phone', 'ios', 'token', 'granted', 'en', 999, 1, 1, 1);
        INSERT INTO notification_events(event_id, dedupe_key, event_type, target_json, priority, title_en, title_zh, payload_json, created_at)
          VALUES ('event', 'dedupe', 'chat.completed', '{}', 'normal', 'Title', 'Title', '{}', 1);
        INSERT INTO notification_deliveries(event_id, device_id, status, next_attempt_at, updated_at)
          VALUES ('event', 'phone', 'pending', 1, 1);
      `);
      applyPendingMigrations(db);
      for (const table of ['devices', 'device_refresh_credentials', 'device_access_sessions', 'device_push_endpoints', 'notification_deliveries']) {
        expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count).toBe(1);
      }
      expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      const insert = db.prepare(`INSERT INTO devices(device_id, display_name, platform, public_key_jwk, scopes_json, created_at)
        VALUES (?, 'Phone', ?, '{}', '[]', 1)`);
      insert.run('harmony', 'harmonyos');
      db.exec(`INSERT INTO device_push_endpoints(device_id, platform, push_token, permissions, locale,
        lease_expires_at, last_seen_at, created_at, updated_at) VALUES ('harmony', 'harmonyos', 'huawei-token', 'granted', 'zh', 999, 1, 1, 1)`);
      expect(() => insert.run('invalid', 'unsupported')).toThrow();
      expect(() => insert.run('browser-without-extension', 'chrome')).toThrow();
      db.prepare('DELETE FROM devices WHERE device_id = ?').run('phone');
      expect(db.prepare('SELECT COUNT(*) AS count FROM device_refresh_credentials').get()?.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
