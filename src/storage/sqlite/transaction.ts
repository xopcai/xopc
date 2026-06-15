import type { DatabaseSync } from 'node:sqlite';

import { getXopcDatabase } from './connection.js';

const RETRYABLE_COMMIT_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED']);
const MAX_COMMIT_ATTEMPTS = 8;

let nextSavepointId = 0;

function nextSavepointName(): string {
  nextSavepointId += 1;
  return `xopc_tx_${nextSavepointId}`;
}

const transactionDepthByDatabase = new WeakMap<DatabaseSync, number>();

function getTransactionDepth(db: DatabaseSync): number {
  return transactionDepthByDatabase.get(db) ?? 0;
}

function setTransactionDepth(db: DatabaseSync, depth: number): void {
  if (depth <= 0) {
    transactionDepthByDatabase.delete(db);
    return;
  }
  transactionDepthByDatabase.set(db, depth);
}

function isRetryableCommitError(error: unknown): boolean {
  const code =
    error && typeof error === 'object'
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' && RETRYABLE_COMMIT_CODES.has(code);
}

function commitImmediateTransaction(db: DatabaseSync): void {
  for (const attempt of Array.from({ length: MAX_COMMIT_ATTEMPTS }, (_, i) => i + 1)) {
    try {
      db.exec('COMMIT');
      return;
    } catch (error) {
      if (!isRetryableCommitError(error) || attempt >= MAX_COMMIT_ATTEMPTS) {
        throw error;
      }
    }
  }
}

function abortImmediateTransaction(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK');
  } catch {
    try {
      db.close();
    } catch {
      // Preserve the original error; close failure is secondary.
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof (value as { then?: unknown }).then === 'function');
}

function assertSyncTransactionResult(value: unknown): void {
  if (isPromiseLike(value)) {
    throw new Error(
      'SQLite write transactions must be synchronous; Promise returns are not supported.',
    );
  }
}

/**
 * Run an operation inside a `BEGIN IMMEDIATE` transaction with nested SAVEPOINT
 * support and COMMIT retry on SQLITE_BUSY / SQLITE_LOCKED.
 *
 * When called inside an already-active transaction, automatically uses SAVEPOINT
 * so the outer transaction controls final COMMIT/ROLLBACK. When called at the
 * top level, owns the full transaction lifecycle with retry on contention.
 */
export function runSqliteWriteTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const { db } = getXopcDatabase();
  const depth = getTransactionDepth(db);

  // Nested call: use SAVEPOINT so outer transaction stays in control.
  if (depth > 0) {
    const savepoint = nextSavepointName();
    db.exec(`SAVEPOINT ${savepoint}`);
    setTransactionDepth(db, depth + 1);
    try {
      const result = fn(db);
      assertSyncTransactionResult(result);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      } finally {
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    } finally {
      setTransactionDepth(db, depth);
    }
  }

  // Top-level: own the full BEGIN IMMEDIATE / COMMIT / ROLLBACK lifecycle.
  db.exec('BEGIN IMMEDIATE');
  setTransactionDepth(db, 1);
  let transactionActive = true;
  let result: T;
  try {
    result = fn(db);
    assertSyncTransactionResult(result);
  } catch (error) {
    try {
      abortImmediateTransaction(db);
      transactionActive = false;
    } catch {
      // Preserve original error; rollback failure is secondary.
    }
    throw error;
  } finally {
    if (!transactionActive) {
      setTransactionDepth(db, 0);
    }
  }

  try {
    commitImmediateTransaction(db);
    transactionActive = false;
    return result;
  } catch (error) {
    try {
      abortImmediateTransaction(db);
      transactionActive = false;
    } catch {
      // Preserve original error; rollback failure is secondary.
    }
    throw error;
  } finally {
    if (!transactionActive) {
      setTransactionDepth(db, 0);
    }
  }
}

export function getSqliteDatabase(): DatabaseSync {
  return getXopcDatabase().db;
}
