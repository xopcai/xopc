import { writeFileSync } from 'node:fs';

import type { DatabaseSync } from 'node:sqlite';

import { createLogger } from '../../../utils/logger.js';
import { currentOperationId } from '../../../infra/operation-context.js';
import { readSchemaVersion, setSchemaVersion } from '../schema-version.js';
import { resolveSqliteAssetPath } from '../sql-assets.js';
import { backupBeforeConversationCutover } from './conversation-backup.js';
import { migrateConversationUuids, type ConversationMigrationSummary } from './conversation-uuid.js';
import { discardExperimentalSceneData, resetExperimentalScenes } from './scene-reset.js';
import { discoverSqlMigrations } from './discover.js';
import {
  DatabaseSchemaMigrationGapError,
  DatabaseSchemaTooNewError,
  DatabaseSchemaTooOldError,
} from './errors.js';
import type { ApplyMigrationsOptions, SqlMigration } from './types.js';

const log = createLogger('Sqlite:Migrations');

/** Baseline schema version applied from schema.sql on first open. */
export const XOPC_DB_BASELINE_SCHEMA_VERSION = 165;

/** Latest schema version this release supports (increment when adding migrations). */
export const XOPC_DB_SCHEMA_VERSION = 201;

function writeMigrationReport(backupPath: string, report: Record<string, unknown>): void {
  const reportPath = `${backupPath}.report.json`;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

export function resolveMigrationsDir(override?: string): string {
  if (override) {
    return override;
  }
  return resolveSqliteAssetPath('migrations');
}

function migrationByTarget(
  migrations: SqlMigration[],
  targetVersion: number,
): SqlMigration | undefined {
  return migrations.find((migration) => migration.targetVersion === targetVersion);
}

function applySingleMigration(db: DatabaseSync, migration: SqlMigration, discardOldScenes = false): ConversationMigrationSummary | undefined {
  log.info({ targetVersion: migration.targetVersion, file: migration.filename }, 'Applying SQLite migration');
  // Schema rebuilds and the experimental scene reset validate all FKs before commit.
  const requiresForeignKeyPause = discardOldScenes || migration.targetVersion === 179 || migration.targetVersion === 182
    || migration.targetVersion === 188 || migration.targetVersion === 200 || migration.targetVersion === 201;
  const foreignKeysEnabled = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) === 1;
  if (requiresForeignKeyPause) db.exec('PRAGMA foreign_keys = OFF');
  let transactionStarted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    if (discardOldScenes) discardExperimentalSceneData(db);
    db.exec(migration.sql);
    if (migration.targetVersion === 188) resetExperimentalScenes(db);
    const summary = migration.targetVersion === 178 ? migrateConversationUuids(db) : undefined;
    if (requiresForeignKeyPause && db.prepare('PRAGMA foreign_key_check').all().length > 0) {
      throw new Error('Schema migration would violate foreign key integrity');
    }
    setSchemaVersion(db, migration.targetVersion);
    db.exec('COMMIT');
    return summary;
  } catch (error) {
    try {
      if (transactionStarted) db.exec('ROLLBACK');
    } catch {
      /* preserve original error */
    }
    const em = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite migration to v${migration.targetVersion} (${migration.filename}) failed: ${em}`,
      { cause: error },
    );
  } finally {
    if (requiresForeignKeyPause && foreignKeysEnabled) db.exec('PRAGMA foreign_keys = ON');
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
  // Required by transactional resource triggers on every connection, including already-current databases.
  db.function('xopc_operation_id', () => currentOperationId() ?? null);
  const targetVersion = options.targetVersion ?? XOPC_DB_SCHEMA_VERSION;
  let currentVersion = readSchemaVersion(db);

  if (currentVersion > targetVersion) {
    throw new DatabaseSchemaTooNewError(currentVersion, targetVersion);
  }

  if (!options.migrationsDir && currentVersion < XOPC_DB_BASELINE_SCHEMA_VERSION) {
    throw new DatabaseSchemaTooOldError(currentVersion, XOPC_DB_BASELINE_SCHEMA_VERSION);
  }

  if (currentVersion >= targetVersion) {
    return currentVersion;
  }

  const migrations = discoverSqlMigrations(resolveMigrationsDir(options.migrationsDir));
  let conversationSummary: ConversationMigrationSummary | undefined;
  const fromVersion = currentVersion;
  const conversationBackup = currentVersion < 178 && targetVersion >= 178 && options.databasePath && options.databasePath !== ':memory:'
    ? backupBeforeConversationCutover(db, options.databasePath) : undefined;

  while (currentVersion < targetVersion) {
    const nextVersion = currentVersion + 1;
    const migration = migrationByTarget(migrations, nextVersion);
    if (!migration) {
      throw new DatabaseSchemaMigrationGapError(currentVersion, targetVersion, nextVersion);
    }
    try {
      // Older scene migrations parse experimental JSON that no longer needs preserving.
      const discardOldScenes = !options.migrationsDir && targetVersion >= 188 && fromVersion < 178 && currentVersion === fromVersion;
      conversationSummary = applySingleMigration(db, migration, discardOldScenes) ?? conversationSummary;
    } catch (error) {
      if (conversationBackup) writeMigrationReport(conversationBackup, { fromVersion, targetVersion, failedVersion: nextVersion, status: 'failed', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    currentVersion = nextVersion;
  }

  if (conversationBackup) writeMigrationReport(conversationBackup, { fromVersion, targetVersion, status: 'succeeded', backupPath: conversationBackup, summary: conversationSummary });
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
