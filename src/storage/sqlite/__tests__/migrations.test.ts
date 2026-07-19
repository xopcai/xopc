import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import { validateMigrationSequence } from '../migrations/discover.js';
import {
  DatabaseSchemaMigrationGapError,
  DatabaseSchemaTooNewError,
} from '../migrations/errors.js';
import {
  applyPendingMigrations,
  inspectSchemaMigrationStatus,
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

describe('SQLite migrations', () => {
  let migrationsDir: string;

  beforeEach(() => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'xopc-sqlite-migrations-'));
  });

  afterEach(() => {
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('validateMigrationSequence rejects gaps in target versions', () => {
    expect(() =>
      validateMigrationSequence([
        { targetVersion: 2, filename: '002_a.sql', sql: '' },
        { targetVersion: 4, filename: '004_b.sql', sql: '' },
      ]),
    ).toThrow(/sequence gap/);
  });

  it('applyPendingMigrations runs sequential SQL files and bumps schema_meta', () => {
    writeFileSync(
      join(migrationsDir, '002_add_probe.sql'),
      `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);`,
    );
    writeFileSync(
      join(migrationsDir, '003_add_probe_meta.sql'),
      `CREATE TABLE migration_probe_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    );

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    const finalVersion = applyPendingMigrations(db, {
      migrationsDir,
      targetVersion: 3,
    });

    expect(finalVersion).toBe(3);
    expect(readSchemaVersion(db)).toBe(3);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'`).get(),
    ).toBeDefined();
  });

  it('rolls back a failed migration and leaves schema version unchanged', () => {
    writeFileSync(
      join(migrationsDir, '002_bad.sql'),
      `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);
       INSERT INTO migration_probe VALUES (1);
       INSERT INTO nonexistent_table VALUES (1);`,
    );

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    expect(() =>
      applyPendingMigrations(db, { migrationsDir, targetVersion: 2 }),
    ).toThrow(/migration to v2.*failed/i);
    expect(readSchemaVersion(db)).toBe(1);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'`).get(),
    ).toBeUndefined();
  });

  it('throws when database schema is newer than the app supports', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 99);

    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 1 })).toThrow(
      DatabaseSchemaTooNewError,
    );
  });

  it('throws when a required migration file is missing', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 2 })).toThrow(
      DatabaseSchemaMigrationGapError,
    );
  });

  it('inspectSchemaMigrationStatus reports pending versions without mutating', () => {
    writeFileSync(
      join(migrationsDir, '002_add_probe.sql'),
      `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);`,
    );

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    const status = inspectSchemaMigrationStatus(db, { migrationsDir, targetVersion: 2 });
    expect(status.pendingVersions).toEqual([2]);
    expect(status.hasMigrationGap).toBe(false);
    expect(readSchemaVersion(db)).toBe(1);
  });

  it('ensureXopcDatabaseSchema applies baseline then leaves version at release target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-schema-'));
    const dbPath = join(dir, 'xopc.db');
    const db = new DatabaseSync(dbPath);
    try {
      ensureXopcDatabaseSchema(db);
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades v33 trust policies to allow a global auto default', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`
      CREATE TABLE user_trust_policies (
        principal_id TEXT PRIMARY KEY,
        default_action_level TEXT NOT NULL DEFAULT 'confirm'
          CHECK (default_action_level IN ('observe', 'suggest', 'confirm')),
        updated_at TEXT NOT NULL
      );
      INSERT INTO user_trust_policies VALUES ('local-owner', 'confirm', '2026-07-19T00:00:00.000Z');
    `);
    setSchemaVersion(db, 33);

    expect(applyPendingMigrations(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    expect(() => db.prepare(`
      UPDATE user_trust_policies
      SET default_action_level = 'auto'
      WHERE principal_id = 'local-owner'
    `).run()).not.toThrow();
    expect(db.prepare(`
      SELECT default_action_level FROM user_trust_policies WHERE principal_id = 'local-owner'
    `).get()).toEqual({ default_action_level: 'auto' });
  });

  it('upgrades v35 goal contracts with measurable outcome storage', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`
      CREATE TABLE goals (goal_id TEXT PRIMARY KEY);
      CREATE TABLE goal_contracts (
        goal_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        objective TEXT NOT NULL,
        scope_boundary TEXT,
        evidence_plan_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
      );
    `);
    setSchemaVersion(db, 35);

    expect(applyPendingMigrations(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    expect(
      db.prepare(`SELECT name FROM pragma_table_info('goal_contracts') WHERE name = 'outcome_metric_json'`).get(),
    ).toEqual({ name: 'outcome_metric_json' });
  });

  it('upgrades v21 databases with first-class work item tables', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`
      CREATE TABLE goals (
        goal_id TEXT PRIMARY KEY
      );
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        default_agent_id TEXT,
        workspace_root TEXT,
        brief TEXT,
        instructions TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER
      );
    `);
    setSchemaVersion(db, 21);

    const finalVersion = applyPendingMigrations(db);

    expect(finalVersion).toBe(XOPC_DB_SCHEMA_VERSION);
    expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    for (const table of [
      'work_items',
      'work_item_links',
      'work_item_events',
      'work_item_attachments',
      'work_item_update_suggestions',
    ]) {
      expect(
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
      ).toBeDefined();
    }
  });

});
