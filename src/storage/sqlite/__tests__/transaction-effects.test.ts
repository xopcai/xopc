import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../index.js';
import { afterSqliteCommit, getSqliteDatabase, runSqliteSavepoint, runSqliteWriteTransaction, SqliteCommitEffectError } from '../transaction.js';

describe('transaction commit effects', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-commit-effects-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    getSqliteDatabase().exec('CREATE TABLE effect_fixture (id INTEGER PRIMARY KEY)');
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });

  it('runs only after the outer commit and permits a new independent transaction', () => {
    const effect = vi.fn(() => runSqliteWriteTransaction(db => db.prepare('INSERT INTO effect_fixture VALUES (2)').run()));
    runSqliteWriteTransaction(db => {
      db.prepare('INSERT INTO effect_fixture VALUES (1)').run();
      runSqliteWriteTransaction(() => afterSqliteCommit(() => { effect(); }));
      expect(effect).not.toHaveBeenCalled();
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(getSqliteDatabase().prepare('SELECT * FROM effect_fixture').all()).toHaveLength(2);
  });

  it('discards only rolled-back nested effects, including explicit savepoints', () => {
    const calls: string[] = [];
    runSqliteWriteTransaction(db => {
      afterSqliteCommit(() => { calls.push('before'); });
      for (const nested of [runSqliteWriteTransaction, (fn: () => void) => runSqliteSavepoint(db, fn)]) {
        expect(() => nested(() => { afterSqliteCommit(() => { calls.push('rolled back'); }); throw new Error('rollback'); })).toThrow('rollback');
      }
      afterSqliteCommit(() => { calls.push('after'); });
    });
    expect(calls).toEqual(['before', 'after']);
  });

  it('discards effects when the outer transaction rolls back', () => {
    const effect = vi.fn();
    expect(() => runSqliteWriteTransaction(() => {
      afterSqliteCommit(effect);
      throw new Error('rollback');
    })).toThrow('rollback');
    runSqliteWriteTransaction(() => {});
    expect(effect).not.toHaveBeenCalled();
    expect(() => afterSqliteCommit(effect)).toThrow('owned');
  });

  it('keeps the commit and drains remaining effects even if one effect fails', () => {
    const remaining = vi.fn();
    expect(() => runSqliteWriteTransaction(db => {
      db.prepare('INSERT INTO effect_fixture VALUES (1)').run();
      afterSqliteCommit(() => { throw new Error('offline'); });
      afterSqliteCommit(remaining);
    })).toThrow(SqliteCommitEffectError);
    expect(getSqliteDatabase().prepare('SELECT * FROM effect_fixture').all()).toHaveLength(1);
    expect(remaining).toHaveBeenCalledTimes(1);
    runSqliteWriteTransaction(() => {});
    expect(remaining).toHaveBeenCalledTimes(1);
  });
});
