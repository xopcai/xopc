import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import { validateMigrationSequence } from '../migrations/discover.js';
import {
  DatabaseSchemaMigrationGapError,
  DatabaseSchemaTooNewError,
  DatabaseSchemaTooOldError,
} from '../migrations/errors.js';
import {
  applyPendingMigrations,
  inspectSchemaMigrationStatus,
  XOPC_DB_BASELINE_SCHEMA_VERSION,
  XOPC_DB_SCHEMA_VERSION,
} from '../migrations/runner.js';
import {
  ensureSchemaMetaTable,
  readSchemaVersion,
  setSchemaVersion,
} from '../schema-version.js';
import { ensureXopcDatabaseSchema } from '../schema.js';

const { DatabaseSync } = requireNodeSqlite();

function openEmptyDb(): InstanceType<typeof DatabaseSync> {
  return new DatabaseSync(':memory:');
}

function installBaseline(db: InstanceType<typeof DatabaseSync>): void {
  ensureSchemaMetaTable(db);
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  setSchemaVersion(db, XOPC_DB_BASELINE_SCHEMA_VERSION);
}

describe('SQLite migrations', () => {
  let migrationsDir: string;

  beforeEach(() => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'xopc-sqlite-migrations-'));
  });

  afterEach(() => {
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('keeps the retained release window at v165 through v178', () => {
    expect(XOPC_DB_BASELINE_SCHEMA_VERSION).toBe(165);
    expect(XOPC_DB_SCHEMA_VERSION).toBe(178);

    const db = openEmptyDb();
    try {
      installBaseline(db);
      expect(applyPendingMigrations(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capability_imports'").get())
        .toEqual({ name: 'capability_imports' });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_routes'").get())
        .toEqual({ name: 'conversation_routes' });
    } finally {
      db.close();
    }
  });

  it('migrates proactive pause controls once without retaining old fields', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 175 });
      db.prepare('INSERT INTO proactive_preferences(workspace_id, preferences_json, revision) VALUES (?, ?, ?)')
        .run('paused', JSON.stringify({ level: 'off', pausedUntil: '2026-09-17T00:00:00Z' }), 4);
      applyPendingMigrations(db);
      const row = db.prepare('SELECT preferences_json, revision FROM proactive_preferences').get()!;
      const preferences = JSON.parse(String(row.preferences_json));
      expect(preferences).toMatchObject({
        level: 'balanced',
        checksPaused: true,
        checksPausedUntil: '2026-09-17T00:00:00Z',
      });
      expect(preferences).not.toHaveProperty('pausedUntil');
      expect(row.revision).toBe(4);
      expect(applyPendingMigrations(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it('bootstraps a fresh database at the release target', () => {
    const db = openEmptyDb();
    try {
      ensureXopcDatabaseSchema(db);
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('SELECT count(*) AS count FROM proactive_scenarios').get()).toEqual({ count: 6 });
    } finally {
      db.close();
    }
  });

  it('validateMigrationSequence rejects gaps regardless of the first retained version', () => {
    expect(() =>
      validateMigrationSequence([
        { targetVersion: 166, filename: '166_a.sql', sql: '' },
        { targetVersion: 168, filename: '168_b.sql', sql: '' },
      ]),
    ).toThrow(/sequence gap/);
  });

  it('applyPendingMigrations runs sequential SQL files and bumps schema_meta', () => {
    writeFileSync(join(migrationsDir, '002_add_probe.sql'), 'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);');
    writeFileSync(join(migrationsDir, '003_add_probe_meta.sql'), 'CREATE TABLE migration_probe_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    expect(applyPendingMigrations(db, { migrationsDir, targetVersion: 3 })).toBe(3);
    expect(readSchemaVersion(db)).toBe(3);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'").get())
      .toBeDefined();
    db.close();
  });

  it('rolls back a failed migration and leaves schema version unchanged', () => {
    writeFileSync(join(migrationsDir, '002_bad.sql'), `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);
      INSERT INTO migration_probe VALUES (1);
      INSERT INTO nonexistent_table VALUES (1);`);

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 2 }))
      .toThrow(/migration to v2.*failed/i);
    expect(readSchemaVersion(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'").get())
      .toBeUndefined();
    db.close();
  });

  it('throws when database schema is newer than the app supports', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 99);
    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 1 }))
      .toThrow(DatabaseSchemaTooNewError);
    db.close();
  });

  it('rejects databases older than the retained release window', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, XOPC_DB_BASELINE_SCHEMA_VERSION - 1);
    expect(() => applyPendingMigrations(db)).toThrow(DatabaseSchemaTooOldError);
    db.close();
  });

  it('throws when a required migration file is missing', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 2 }))
      .toThrow(DatabaseSchemaMigrationGapError);
    db.close();
  });

  it('inspectSchemaMigrationStatus reports pending versions without mutating', () => {
    writeFileSync(join(migrationsDir, '002_add_probe.sql'), 'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);');
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    const status = inspectSchemaMigrationStatus(db, { migrationsDir, targetVersion: 2 });
    expect(status.pendingVersions).toEqual([2]);
    expect(status.hasMigrationGap).toBe(false);
    expect(readSchemaVersion(db)).toBe(1);
    db.close();
  });
});
