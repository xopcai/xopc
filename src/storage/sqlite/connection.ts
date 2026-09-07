import fs from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { requireNodeSqlite } from '../../infra/node-sqlite.js';
import { installSqliteTransientRejectionHandler } from '../../infra/unhandled-rejections.js';
import { createLogger } from '../../utils/logger.js';
import { resolveXopcDatabasePath } from './paths.js';
import { ensureXopcDatabaseSchema } from './schema.js';

const log = createLogger('Sqlite:Connection');

const XOPC_SQLITE_BUSY_TIMEOUT_MS = 30_000;
const DB_DIR_MODE = 0o700;
const DB_FILE_MODE = 0o600;
const DB_SIDECAR_SUFFIXES = ['', '-shm', '-wal'] as const;
const LINUX_NFS_SUPER_MAGIC = 0x6969;
const PROC_MOUNTINFO_PATH = '/proc/self/mountinfo';
const MAX_TIMER_TIMEOUT_MS = 2 ** 31 - 1;

type IntervalHandle = ReturnType<typeof setInterval> & { unref?: () => void };
type SqliteWalCheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';

export type SqliteWalMaintenance = {
  checkpoint: () => boolean;
  close: () => boolean;
};

export type SqliteConnectionPragmaOptions = {
  autoCheckpointPages?: number;
  checkpointIntervalMs?: number;
  checkpointMode?: SqliteWalCheckpointMode;
  busyTimeoutMs?: number;
  foreignKeys?: boolean;
  synchronous?: 'NORMAL' | 'FULL';
  onCheckpointError?: (error: unknown) => void;
};

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Network filesystem detection
// ---------------------------------------------------------------------------

function findExistingVolumePath(targetPath: string): string | null {
  let current = path.resolve(targetPath);
  while (true) {
    try {
      const stats = fs.statSync(current);
      return stats.isDirectory() ? current : path.dirname(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function decodeMountPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

function parseProcMountInfoEntries(
  contents: string,
): Array<{ mountPoint: string; fsType: string }> {
  const entries: Array<{ mountPoint: string; fsType: string }> = [];
  for (const line of contents.split('\n')) {
    const separator = line.indexOf(' - ');
    if (separator === -1) continue;
    const fields = line.slice(0, separator).split(' ');
    const suffixFields = line.slice(separator + 3).split(' ');
    const mountPoint = fields[4];
    const fsType = suffixFields[0];
    if (mountPoint && fsType) {
      entries.push({ mountPoint: decodeMountPath(mountPoint), fsType });
    }
  }
  return entries;
}

function parseMountCommandEntries(contents: string): Array<{ mountPoint: string; fsType: string }> {
  const entries: Array<{ mountPoint: string; fsType: string }> = [];
  for (const line of contents.split('\n')) {
    // Linux: /dev/sda1 on /mnt type ext4 (rw,relatime)
    const linuxMatch = /^.* on (.+) type ([^,\s)]+) \(/.exec(line);
    if (linuxMatch) {
      entries.push({ mountPoint: linuxMatch[1], fsType: linuxMatch[2] });
      continue;
    }
    // macOS/BSD: //host/share on /Volumes/share (nfs, nodev, nosuid)
    const bsdMatch = /^.* on (.+) \(([^,\s)]+)/.exec(line);
    if (bsdMatch) {
      entries.push({ mountPoint: bsdMatch[1], fsType: bsdMatch[2] });
    }
  }
  return entries;
}

function readMountEntries(): Array<{ mountPoint: string; fsType: string }> {
  try {
    return parseProcMountInfoEntries(fs.readFileSync(PROC_MOUNTINFO_PATH, 'utf8'));
  } catch {
    // macOS/BSD: fall through to mount command
  }
  try {
    return parseMountCommandEntries(String(childProcess.execFileSync('mount', [])));
  } catch {
    return [];
  }
}

function isPathWithinMount(targetPath: string, mountPoint: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedMountPoint = path.resolve(mountPoint);
  return (
    resolvedTarget === resolvedMountPoint ||
    resolvedMountPoint === path.parse(resolvedMountPoint).root ||
    resolvedTarget.startsWith(`${resolvedMountPoint}${path.sep}`)
  );
}

function isNetworkMountType(fsType: string): boolean {
  const type = fsType.toLowerCase();
  return type.startsWith('nfs') || ['cifs', 'smbfs', 'smb3', 'fuse.sshfs'].includes(type);
}

function isNetworkMountEntryPath(targetPath: string): boolean {
  const mountEntry = readMountEntries()
    .filter((entry) => isPathWithinMount(targetPath, entry.mountPoint))
    .toSorted((a, b) => b.mountPoint.length - a.mountPoint.length)[0];
  return mountEntry ? isNetworkMountType(mountEntry.fsType) : false;
}

function isNetworkBackedPath(targetPath: string): boolean {
  if (typeof fs.statfsSync !== 'function') {
    return isNetworkMountEntryPath(targetPath);
  }
  const checkedPath = findExistingVolumePath(targetPath);
  if (!checkedPath) return false;
  try {
    if ([LINUX_NFS_SUPER_MAGIC, 0xff534d42, 0xfe534d42, 0x517b].includes(fs.statfsSync(checkedPath).type >>> 0)) return true;
  } catch {
    return isNetworkMountEntryPath(checkedPath);
  }
  return isNetworkMountEntryPath(checkedPath);
}

// ---------------------------------------------------------------------------
// Connection durability and WAL maintenance
// ---------------------------------------------------------------------------

function configureSqliteConnectionPragmas(
  db: DatabaseSync,
  options: SqliteConnectionPragmaOptions = {},
): SqliteWalMaintenance {
  // Set busy_timeout before journal_mode to avoid lock-retry ordering issues
  const busyTimeoutMs = options.busyTimeoutMs ?? XOPC_SQLITE_BUSY_TIMEOUT_MS;
  db.exec(`PRAGMA busy_timeout = ${normalizeNonNegativeInteger(busyTimeoutMs, 'busyTimeoutMs')};`);


  // WAL setup
  db.exec('PRAGMA journal_mode = WAL;');
  const autoCheckpointPages = normalizeNonNegativeInteger(
    options.autoCheckpointPages ?? 1000,
    'autoCheckpointPages',
  );
  db.exec(`PRAGMA wal_autocheckpoint = ${autoCheckpointPages};`);

  // Remaining pragmas in safe order
  if (options.synchronous) db.exec(`PRAGMA synchronous = ${options.synchronous};`);
  if (options.foreignKeys) db.exec('PRAGMA foreign_keys = ON;');

  // Periodic checkpoint timer
  const checkpointMode = options.checkpointMode ?? 'TRUNCATE';
  const periodicCheckpointMode = options.checkpointMode ?? 'PASSIVE';
  const checkpointIntervalMs = normalizeNonNegativeInteger(
    options.checkpointIntervalMs ?? 30 * 60 * 1000,
    'checkpointIntervalMs',
  );

  const runCheckpoint = (mode: SqliteWalCheckpointMode): boolean => {
    try {
      const row = db.prepare(`PRAGMA wal_checkpoint(${mode});`).get() as { busy: number };
      return row.busy === 0;
    } catch (error) {
      options.onCheckpointError?.(error);
      return false;
    }
  };

  let timer: IntervalHandle | null = null;
  if (checkpointIntervalMs > 0) {
    const timerIntervalMs = Math.min(checkpointIntervalMs, MAX_TIMER_TIMEOUT_MS);
    timer = setInterval(() => runCheckpoint(periodicCheckpointMode), timerIntervalMs) as IntervalHandle;
    timer.unref?.();
  }

  return {
    checkpoint: () => runCheckpoint(checkpointMode),
    close: () => {
      if (timer) { clearInterval(timer); timer = null; }
      return runCheckpoint(checkpointMode);
    },
  };
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

export type XopcDatabase = {
  db: DatabaseSync;
  path: string;
  walMaintenance: SqliteWalMaintenance;
};

export type OpenXopcDatabaseOptions = {
  path?: string;
  env?: NodeJS.ProcessEnv;
};

let cachedDatabase: XopcDatabase | null = null;

function ensureDatabasePermissions(pathname: string): void {
  const dir = pathname.slice(0, Math.max(pathname.lastIndexOf('/'), pathname.lastIndexOf('\\')));
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, DB_DIR_MODE);
  }
  for (const suffix of DB_SIDECAR_SUFFIXES) {
    const candidate = `${pathname}${suffix}`;
    if (!fs.existsSync(candidate)) continue;
    fs.chmodSync(candidate, DB_FILE_MODE);
  }
}

function openDatabaseAtPath(pathname: string): XopcDatabase {
  installSqliteTransientRejectionHandler();
  if (pathname !== ':memory:' && isNetworkBackedPath(pathname)) {
    throw new Error('SQLite requires a local filesystem; run the Gateway on the NAS instead of opening a network-mounted database.');
  }
  ensureDatabasePermissions(pathname);

  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(pathname);

  // Single call: Configure durability before exposing the connection.
  let walMaintenance: SqliteWalMaintenance | undefined;
  try {
    walMaintenance = configureSqliteConnectionPragmas(db, {
      synchronous: 'FULL',
      foreignKeys: true,
      onCheckpointError: (error) => {
        const em = error instanceof Error ? error.message : String(error);
        log.warn({ err: error instanceof Error ? error : undefined, errorMessage: em }, `SQLite WAL checkpoint failed: ${em}`);
      },
    });

    ensureXopcDatabaseSchema(db, { databasePath: pathname });
    ensureDatabasePermissions(pathname);

    log.info({ path: pathname }, 'Opened xopc SQLite database');
    return { db, path: pathname, walMaintenance };
  } catch (error) {
    try { walMaintenance?.close(); } finally { db.close(); }
    throw error;
  }
}

export function openXopcDatabase(options: OpenXopcDatabaseOptions = {}): XopcDatabase {
  const env = options.env ?? process.env;
  const pathname = options.path ?? resolveXopcDatabasePath(env);

  if (cachedDatabase && cachedDatabase.path === pathname) {
    return cachedDatabase;
  }

  if (cachedDatabase) {
    closeXopcDatabase();
  }

  cachedDatabase = openDatabaseAtPath(pathname);
  return cachedDatabase;
}

export function getXopcDatabase(): XopcDatabase {
  if (!cachedDatabase) {
    throw new Error('xopc SQLite database is not open; call openXopcDatabase() first');
  }
  return cachedDatabase;
}

/**
 * Ensure the xopc SQLite database is open and return it.
 * Opens with default path if not already open. Use this instead of
 * the repetitive `if (!isXopcDatabaseOpen()) { openXopcDatabase(); }` pattern.
 */
export function requireXopcDatabase(options?: OpenXopcDatabaseOptions): XopcDatabase {
  if (!cachedDatabase) {
    openXopcDatabase(options ?? {});
  }
  return cachedDatabase!;
}

export function isXopcDatabaseOpen(): boolean {
  return cachedDatabase !== null;
}

export function closeXopcDatabase(): void {
  if (!cachedDatabase) {
    return;
  }

  const { db, path, walMaintenance } = cachedDatabase;
  try {
    walMaintenance.close();
  } catch (error) {
    const em = error instanceof Error ? error.message : String(error);
    log.warn({ err: error instanceof Error ? error : undefined, errorMessage: em, path }, `SQLite close checkpoint failed: ${em}`);
  }

  try {
    db.close();
  } catch (error) {
    const em = error instanceof Error ? error.message : String(error);
    log.warn({ err: error instanceof Error ? error : undefined, errorMessage: em, path }, `SQLite database close failed: ${em}`);
  }

  cachedDatabase = null;
  log.debug({ path }, 'Closed xopc SQLite database');
}

/** Test-only: reset singleton without touching files on disk. */
export function resetXopcDatabaseSingletonForTest(): void {
  cachedDatabase = null;
}
