import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyPendingMigrations } from '../migrations/runner.js';
import { ensureSchemaMetaTable, readSchemaVersion, setSchemaVersion } from '../schema-version.js';
import { ensureXopcDatabaseSchema } from '../schema.js';
import { assertSceneStorageReady, SCENE_TABLES } from '../scenes-schema.js';
import { readSqliteAsset } from '../sql-assets.js';
import { SceneRepository } from '../../../scenes/repository.js';
import { familyPlanTemplate } from '../../../scenes/templates.js';

describe('scene storage startup without historical imports', () => {
  let directory: string;
  let db: DatabaseSync;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-scene-reset-'));
    db = new DatabaseSync(join(directory, 'xopc.db'));
    db.exec('PRAGMA foreign_keys = ON');
  });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const oldDatabase = () => {
    ensureSchemaMetaTable(db);
    db.exec(readSqliteAsset('schema.sql'));
    setSchemaVersion(db, 165);
    applyPendingMigrations(db, { targetVersion: 187 });
  };
  const event = (id: string, type: string) => {
    db.prepare(`INSERT INTO notification_events(event_id, dedupe_key, event_type, target_json, priority, title_en, title_zh, created_at)
      VALUES (?, ?, ?, 'obsolete payload', 'normal', 'Title', 'Title', 1)`).run(id, id, type);
    db.prepare("INSERT INTO notification_acknowledgements VALUES (?, 'browser', 'web', 1)").run(id);
  };

  it('adds source health to v188 without resetting current scenes', () => {
    ensureXopcDatabaseSchema(db);
    const repository = new SceneRepository(db);
    repository.installTemplate(familyPlanTemplate);
    const principal = { ownerId: 'owner', workspaceId: 'workspace' };
    const activation = repository.createActivation(principal, { templateKey: familyPlanTemplate.key,
      templateVersion: familyPlanTemplate.version, goal: 'Keep current user data', scope: { kind: 'personal' },
      permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } });
    db.exec('DROP TABLE scene_source_health'); setSchemaVersion(db, 188);
    applyPendingMigrations(db);
    expect(readSchemaVersion(db)).toBe(189);
    expect(repository.getActivation(principal, activation.id).goal).toBe('Keep current user data');
    expect(() => assertSceneStorageReady(db)).not.toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('initializes a fresh database through the normal startup path', () => {
    ensureXopcDatabaseSchema(db);
    expect(() => assertSceneStorageReady(db)).not.toThrow();
    expect(readSchemaVersion(db)).toBe(189);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'scene_%'").all().map(row => row.name))
      .toEqual(expect.arrayContaining([...SCENE_TABLES]));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'scene_cutover_journal'").get()).toBeUndefined();
  });

  it('discards malformed experimental data and stale notifications without reading their payloads', () => {
    oldDatabase();
    db.exec(`INSERT INTO proactive_preferences VALUES ('workspace', 'not valid json', 1);
      INSERT INTO proactive_presence(workspace_id, client_id, surface, expires_at) VALUES ('workspace', 'browser', 'web', 999999);
      CREATE TABLE scene_cutover_journal(obsolete TEXT);
      INSERT INTO scene_cutover_journal VALUES ('db_committed with a missing snapshot');
      CREATE TABLE scene_activations(obsolete TEXT);
      INSERT INTO scene_activations VALUES ('incompatible draft');
      CREATE TABLE unrelated_user_data(content TEXT);
      INSERT INTO unrelated_user_data VALUES ('keep');`);
    event('old', 'proactive.insight'); event('draft', 'scene.result'); event('keep', 'task.completed');
    ensureXopcDatabaseSchema(db);
    expect(() => assertSceneStorageReady(db)).not.toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'proactive_preferences'").get()).toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'proactive_presence'").get()).toBeUndefined();
    expect(db.prepare('SELECT * FROM scene_activations').all()).toEqual([]);
    expect(db.prepare('SELECT event_id FROM notification_events').all()).toEqual([{ event_id: 'keep' }]);
    expect(db.prepare('SELECT event_id FROM notification_acknowledgements').all()).toEqual([{ event_id: 'keep' }]);
    expect(db.prepare('SELECT content FROM unrelated_user_data').get()?.content).toBe('keep');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each([165, 175, 177])('discards obsolete malformed payloads before older migrations run from v%s', (version) => {
    ensureSchemaMetaTable(db);
    db.exec(readSqliteAsset('schema.sql'));
    setSchemaVersion(db, 165);
    applyPendingMigrations(db, { targetVersion: version });
    db.exec("INSERT INTO proactive_preferences VALUES ('workspace', 'not valid json', 1)");
    ensureXopcDatabaseSchema(db);
    expect(() => assertSceneStorageReady(db)).not.toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'proactive_preferences'").get()).toBeUndefined();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('never resets new scene data on restart', () => {
    oldDatabase(); ensureXopcDatabaseSchema(db);
    const repository = new SceneRepository(db);
    repository.installTemplate(familyPlanTemplate);
    const principal = { ownerId: 'owner', workspaceId: directory };
    const activation = repository.createActivation(principal, { templateKey: familyPlanTemplate.key, templateVersion: familyPlanTemplate.version,
      goal: 'Plan next week', scope: { kind: 'personal' }, permissions: { accountIds: [], contextProviders: ['user_notes'], effectHandlers: [] } });
    repository.writeNotes(principal, activation.id, { expectedRevision: 0, content: 'Keep Sunday free' }, Date.now());
    db.close(); db = new DatabaseSync(join(directory, 'xopc.db')); db.exec('PRAGMA foreign_keys = ON');
    ensureXopcDatabaseSchema(db);
    expect(new SceneRepository(db).readNotes(principal, activation.id)?.content).toBe('Keep Sunday free');
    expect(() => assertSceneStorageReady(db)).not.toThrow();
  });

  it('rolls back a failed reset and safely retries the normal upgrade', () => {
    oldDatabase();
    db.exec(`INSERT INTO proactive_preferences VALUES ('workspace', 'obsolete', 1);
      CREATE TRIGGER refuse_reset BEFORE DELETE ON notification_events BEGIN SELECT RAISE(ABORT, 'injected reset failure'); END;`);
    event('old', 'proactive.insight');
    expect(() => ensureXopcDatabaseSchema(db)).toThrow('injected reset failure');
    expect(readSchemaVersion(db)).toBe(187);
    expect(db.prepare('SELECT count(*) AS n FROM proactive_preferences').get()?.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'scene_activations'").get()).toBeUndefined();
    db.exec('DROP TRIGGER refuse_reset');
    ensureXopcDatabaseSchema(db);
    expect(() => assertSceneStorageReady(db)).not.toThrow();
  });
});
