import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installSceneCutoverSchema } from '../../storage/sqlite/migrations/scenes/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { convertScenePreferences } from '../../storage/sqlite/migrations/scenes/preferences.js';
import { sceneChecksAllowed, ScenePreferenceService } from '../preferences.js';

describe('scene preferences and historical attention controls', () => {
  let directory: string;
  let db: DatabaseSync;
  const principal = { ownerId: 'owner', workspaceId: 'workspace' };
  const convert = () => convertScenePreferences(db, { owners: [principal], presentations: [] });
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-scene-preferences-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') }); db = getSqliteDatabase();
    installSceneCutoverSchema(db);
    db.prepare('INSERT INTO proactive_preferences VALUES (?, ?, ?)').run('workspace', JSON.stringify({
      revision: 2, timezone: 'America/New_York', level: 'quiet', notificationsMuted: true, checksPaused: true,
      checksPausedUntil: '2099-01-01T00:00:00Z', quietStartHour: 20, quietEndHour: 9,
      preferredChannel: 'telegram', telegram: { chatId: '123', accountId: 'personal', publicUrl: 'https://console.example/app' },
      dailyNotificationLimit: 2, digestEnabled: true, digestHour: 17, digestMinute: 30, suppressWhileViewing: false,
    }), 2);
    db.exec("INSERT INTO proactive_presence(workspace_id, client_id, surface, expires_at) VALUES ('workspace', 'client', 'web', 1000)");
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });

  it('preserves all controls and their revision without renewing expired presence', () => {
    expect(convert()).toEqual({ preferences: 1, presence: 1 });
    const preferences = new ScenePreferenceService(db).get(principal);
    expect(preferences).toEqual(JSON.parse(String(db.prepare('SELECT preferences_json FROM proactive_preferences').get()?.preferences_json)));
    expect(db.prepare('SELECT * FROM notification_presence').get()).toMatchObject({ owner_id: 'owner', workspace_id: 'workspace', expires_at: 1000, subject_id: null });
    expect(sceneChecksAllowed(preferences, Date.now())).toBe(false);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_presence').get()?.n).toBe(1);
  });

  it('uses CAS and patches only supplied fields, keeping mute separate from check pause', () => {
    convert(); const service = new ScenePreferenceService(db);
    const next = service.update(principal, { expectedRevision: 2, notificationsMuted: false });
    expect(next).toMatchObject({ revision: 3, timezone: 'America/New_York', level: 'quiet', checksPaused: true, notificationsMuted: false, preferredChannel: 'telegram' });
    expect(() => service.update(principal, { expectedRevision: 2, checksPaused: false })).toThrow('changed');
    expect(service.get(principal).checksPaused).toBe(true);
    expect(() => service.update(principal, { expectedRevision: 3, unknown: true })).toThrow();
  });

  it('isolates principals and requires valid destinations and timezones', () => {
    convert(); const service = new ScenePreferenceService(db);
    expect(service.get({ ...principal, ownerId: 'other' })).toMatchObject({ revision: 0, checksPaused: false });
    expect(() => service.update(principal, { expectedRevision: 2, timezone: 'invalid' })).toThrow();
    expect(() => service.update(principal, { expectedRevision: 2, telegram: null })).toThrow('destination');
    expect(() => service.get({ ...principal, ownerId: '' })).toThrow('required');
  });

  it.each([
    "UPDATE proactive_preferences SET preferences_json = '{\"unknown\":true}'",
    "UPDATE proactive_preferences SET preferences_json = '{\"revision\":3}'",
    "UPDATE proactive_preferences SET workspace_id = 'other'",
    "UPDATE proactive_presence SET inbox_item_id = 'missing', notification_revision = 1",
  ])('rejects incomplete or invalid history and rolls back: %s', (sql) => {
    db.exec(sql); expect(convert).toThrow();
    expect(db.prepare('SELECT * FROM scene_preferences').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM notification_presence').all()).toEqual([]);
  });

  it('joins the enclosing cutover and rejects repeat imports', () => {
    db.exec('BEGIN'); convert(); db.exec('ROLLBACK');
    expect(db.prepare('SELECT * FROM scene_preferences').all()).toEqual([]);
    convert(); expect(convert).toThrow();
    expect(db.prepare('SELECT revision FROM scene_preferences').get()?.revision).toBe(2);
  });
});
