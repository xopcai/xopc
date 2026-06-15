import type { DatabaseSync } from 'node:sqlite';

import { getXopcDatabase } from './connection.js';

export function withSqliteWriteTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const { db } = getXopcDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getSqliteDatabase(): DatabaseSync {
  return getXopcDatabase().db;
}
