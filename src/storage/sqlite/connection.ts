import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { requireNodeSqlite } from '../../infra/node-sqlite.js';
import { installSqliteTransientRejectionHandler } from '../../infra/unhandled-rejections.js';
import { configureSqliteWalMaintenance, type SqliteWalMaintenance } from '../../infra/sqlite-wal.js';
import { createLogger } from '../../utils/logger.js';
import { resolveXopcDatabasePath } from './paths.js';
import { ensureXopcDatabaseSchema } from './schema.js';

const log = createLogger('Sqlite:Connection');

const DB_DIR_MODE = 0o700;
const DB_FILE_MODE = 0o600;
const DB_SIDECAR_SUFFIXES = ['', '-shm', '-wal'] as const;

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
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, DB_DIR_MODE);
  }
  for (const suffix of DB_SIDECAR_SUFFIXES) {
    const candidate = `${pathname}${suffix}`;
    if (!existsSync(candidate)) {
      continue;
    }
    chmodSync(candidate, DB_FILE_MODE);
  }
}

function openDatabaseAtPath(pathname: string): XopcDatabase {
  installSqliteTransientRejectionHandler();
  ensureDatabasePermissions(pathname);

  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(pathname);
  const walMaintenance = configureSqliteWalMaintenance(db, {
    onCheckpointError: (error) => {
      const em = error instanceof Error ? error.message : String(error);
      log.warn({ err: error instanceof Error ? error : undefined, errorMessage: em }, `SQLite WAL checkpoint failed: ${em}`);
    },
  });

  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  ensureXopcDatabaseSchema(db);
  ensureDatabasePermissions(pathname);

  log.info({ path: pathname }, 'Opened xopc SQLite database');

  return { db, path: pathname, walMaintenance };
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
