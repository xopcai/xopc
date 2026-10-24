import { randomUUID } from 'node:crypto';
import { chmodSync, readdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { createLogger } from '../../utils/logger.js';
import { assertDatabaseOffline, flushBackupFile } from './offline-access.js';
import { DatabaseSchemaMigrationFailedError, DatabaseSchemaMigrationGapError } from './schema-errors.js';
import { readSchemaVersion, setSchemaVersion } from './schema-version.js';
import { readSqliteAsset, resolveSqliteAssetPath } from './sql-assets.js';

// v202 was current at the start of the supported 2026-09-24–2026-10-24 release window.
export const XOPC_DB_MINIMUM_SCHEMA_VERSION = 202;
const log = createLogger('Sqlite:Upgrade');

/** Keep the complete historical schema and data; retired features are never reactivated. */
export function upgradeXopcDatabase(db: DatabaseSync, fromVersion: number, targetVersion: number): void {
  // Read the entire chain before creating a backup or changing any database content.
  let files: string[];
  try {
    files = readdirSync(resolveSqliteAssetPath('upgrades'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new DatabaseSchemaMigrationGapError(fromVersion, targetVersion, fromVersion + 1);
  }
  const migrations: string[] = [];
  for (let version = fromVersion + 1; version <= targetVersion; version++) {
    const matches = files.filter(file => file.startsWith(`${version}_`) && file.endsWith('.sql'));
    if (matches.length !== 1) throw new DatabaseSchemaMigrationGapError(fromVersion, targetVersion, version);
    migrations.push(readSqliteAsset(`upgrades/${matches[0]}`));
  }

  const databasePath = (db.prepare('PRAGMA database_list').all() as { name: string; file: string }[])
    .find(row => row.name === 'main')?.file;
  let backupPath: string | undefined;
  if (databasePath) {
    assertDatabaseOffline(databasePath);
    backupPath = `${databasePath}.pre-upgrade-v${fromVersion}-${randomUUID()}.bak`;
    // VACUUM INTO includes committed WAL contents without copying live sidecars.
    db.prepare('VACUUM main INTO ?').run(backupPath);
    chmodSync(backupPath, 0o600);
    flushBackupFile(backupPath);
    log.info({ path: databasePath, backupPath, fromVersion, targetVersion }, 'Created pre-upgrade SQLite backup');
  }

  const foreignKeysEnabled = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) === 1;
  db.exec('PRAGMA foreign_keys = OFF');
  let transactionStarted = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    if (readSchemaVersion(db) !== fromVersion) throw new Error('Database version changed during upgrade; retry startup');
    for (const sql of migrations) db.exec(sql);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database upgrade would violate foreign key integrity');
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Database upgrade failed integrity validation');
    setSchemaVersion(db, targetVersion);
    db.exec('COMMIT');
    transactionStarted = false;
    log.info({ fromVersion, targetVersion, backupPath }, 'Upgraded xopc SQLite database');
  } catch (error) {
    if (transactionStarted) db.exec('ROLLBACK');
    throw new DatabaseSchemaMigrationFailedError(fromVersion, targetVersion, backupPath, error);
  } finally {
    if (foreignKeysEnabled) db.exec('PRAGMA foreign_keys = ON');
  }
}
