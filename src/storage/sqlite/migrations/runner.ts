import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DatabaseSync } from 'node:sqlite';

import { createLogger } from '../../../utils/logger.js';
import { readSchemaVersion, setSchemaVersion } from '../schema-version.js';
import { discoverSqlMigrations } from './discover.js';
import {
  DatabaseSchemaMigrationGapError,
  DatabaseSchemaTooNewError,
} from './errors.js';
import type { ApplyMigrationsOptions, SqlMigration } from './types.js';

const log = createLogger('Sqlite:Migrations');

/** Baseline schema version applied from schema.sql on first open. */
export const XOPC_DB_BASELINE_SCHEMA_VERSION = 11;

/** Latest schema version this release supports (increment when adding migrations). */
export const XOPC_DB_SCHEMA_VERSION = 24;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export function resolveMigrationsDir(override?: string): string {
  if (override) {
    return override;
  }
  // Packaged Electron gateway bundle: `out/server/index.js` + `out/server/migrations/`.
  const siblingDir = join(MODULE_DIR, 'migrations');
  if (existsSync(siblingDir)) {
    return siblingDir;
  }
  // Dev / dist: SQL files live next to `migrations/runner.js`.
  return MODULE_DIR;
}

function migrationByTarget(
  migrations: SqlMigration[],
  targetVersion: number,
): SqlMigration | undefined {
  return migrations.find((migration) => migration.targetVersion === targetVersion);
}

function applySingleMigration(db: DatabaseSync, migration: SqlMigration): void {
  log.info({ targetVersion: migration.targetVersion, file: migration.filename }, 'Applying SQLite migration');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration.sql);
    setSchemaVersion(db, migration.targetVersion);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* preserve original error */
    }
    const em = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite migration to v${migration.targetVersion} (${migration.filename}) failed: ${em}`,
      { cause: error },
    );
  }
}

/**
 * Apply sequential SQL migrations from (currentVersion + 1) through targetVersion.
 * Each step runs in its own transaction and updates schema_meta on success.
 */
export function applyPendingMigrations(
  db: DatabaseSync,
  options: ApplyMigrationsOptions = {},
): number {
  const targetVersion = options.targetVersion ?? XOPC_DB_SCHEMA_VERSION;
  let currentVersion = readSchemaVersion(db);

  if (currentVersion > targetVersion) {
    throw new DatabaseSchemaTooNewError(currentVersion, targetVersion);
  }

  if (currentVersion >= targetVersion) {
    return currentVersion;
  }

  const migrations = discoverSqlMigrations(resolveMigrationsDir(options.migrationsDir));

  while (currentVersion < targetVersion) {
    const nextVersion = currentVersion + 1;
    const migration = migrationByTarget(migrations, nextVersion);
    if (!migration) {
      throw new DatabaseSchemaMigrationGapError(currentVersion, targetVersion, nextVersion);
    }
    applySingleMigration(db, migration);
    currentVersion = nextVersion;
  }

  return currentVersion;
}

export type SchemaMigrationStatus = {
  dbVersion: number;
  appVersion: number;
  pendingVersions: number[];
  isTooNew: boolean;
  hasMigrationGap: boolean;
  missingVersion: number | null;
};

/** Inspect schema version without mutating the database. */
export function inspectSchemaMigrationStatus(
  db: DatabaseSync,
  options: Pick<ApplyMigrationsOptions, 'migrationsDir' | 'targetVersion'> = {},
): SchemaMigrationStatus {
  const appVersion = options.targetVersion ?? XOPC_DB_SCHEMA_VERSION;
  const dbVersion = readSchemaVersion(db);
  const isTooNew = dbVersion > appVersion;

  if (isTooNew) {
    return {
      dbVersion,
      appVersion,
      pendingVersions: [],
      isTooNew: true,
      hasMigrationGap: false,
      missingVersion: null,
    };
  }

  const migrations = discoverSqlMigrations(resolveMigrationsDir(options.migrationsDir));
  const pendingVersions: number[] = [];
  let hasMigrationGap = false;
  let missingVersion: number | null = null;

  for (let version = dbVersion + 1; version <= appVersion; version++) {
    if (migrationByTarget(migrations, version)) {
      pendingVersions.push(version);
    } else {
      hasMigrationGap = true;
      missingVersion = version;
      break;
    }
  }

  return {
    dbVersion,
    appVersion,
    pendingVersions,
    isTooNew: false,
    hasMigrationGap,
    missingVersion,
  };
}
