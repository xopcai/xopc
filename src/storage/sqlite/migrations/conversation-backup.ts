import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, fsyncSync, openSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import { windowsDatabaseOwners } from './conversation-windows-owners.js';

type BackupFileSyncOperations = {
  open(path: string, flags: string): number;
  fsync(fd: number): void;
  close(fd: number): void;
};

const backupFileSyncOperations: BackupFileSyncOperations = {
  open: openSync,
  fsync: fsyncSync,
  close: closeSync,
};

/** Windows requires write access on a file handle before FlushFileBuffers/fsync. */
export function flushBackupFile(
  backupPath: string,
  operations: BackupFileSyncOperations = backupFileSyncOperations,
): void {
  const fd = operations.open(backupPath, 'r+');
  try {
    operations.fsync(fd);
  } finally {
    operations.close(fd);
  }
}

function isSkippableProcError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'EACCES' || code === 'EPERM';
}

function databaseOwners(databasePath: string): string[] {
  if (process.platform === 'win32') return windowsDatabaseOwners(databasePath);
  if (process.platform === 'linux') {
    const paths = new Set([databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map(path => resolve(path)));
    const owners: string[] = [];
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name) && name !== String(process.pid))) {
      try {
        // State files are private to this user; other users cannot open them.
        if (statSync(`/proc/${pid}`).uid !== process.getuid?.()) continue;
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          try {
            if (paths.has(readlinkSync(`/proc/${pid}/fd/${fd}`))) { owners.push(pid); break; }
          } catch (error) {
            if (!isSkippableProcError(error)) throw error;
          }
        }
      } catch (error) {
        if (!isSkippableProcError(error)) throw error;
      }
    }
    return owners;
  }
  let owners: string;
  try {
    owners = execFileSync('lsof', ['-t', '--', databasePath, `${databasePath}-wal`, `${databasePath}-shm`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const result = error as { status?: number; stdout?: string };
    if (result.status !== 1) throw new Error('Cannot verify database owners before upgrade; lsof is required.', { cause: error });
    owners = String(result.stdout ?? '');
  }
  return [...new Set(owners.trim().split(/\s+/).filter(pid => pid && pid !== String(process.pid)))];
}

/** Offline migrations must reject processes that still hold the database open. */
export function assertDatabaseOffline(databasePath: string): void {
  const otherOwners = databaseOwners(databasePath);
  if (otherOwners.length) throw new Error(`Stop other xopc database processes before upgrading: ${otherOwners.join(', ')}`);
}

/** Create and verify an offline SQLite backup before a cross-version cutover. */
export function backupDatabaseBeforeCutover(
  db: DatabaseSync,
  databasePath: string,
  label: string,
): string {
  assertDatabaseOffline(databasePath);

  const backupPath = `${databasePath}.pre-${label}-${Date.now()}.bak`;
  db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  chmodSync(backupPath, 0o600);
  const { DatabaseSync: SqliteDatabase } = requireNodeSqlite();
  const snapshot = new SqliteDatabase(backupPath, { readOnly: true });
  try {
    const rows = snapshot.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('Pre-upgrade backup failed integrity verification');
  } finally {
    snapshot.close();
  }
  flushBackupFile(backupPath);
  return backupPath;
}

/** The old release does not participate in an application lock, so check open handles. */
export function backupBeforeConversationCutover(db: DatabaseSync, databasePath: string): string {
  return backupDatabaseBeforeCutover(db, databasePath, 'v178');
}
