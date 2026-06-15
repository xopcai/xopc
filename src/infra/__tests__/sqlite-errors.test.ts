import { describe, expect, it } from 'vitest';

import { isTransientSqliteError } from '../sqlite-errors.js';

describe('isTransientSqliteError', () => {
  it('detects SQLITE_BUSY code', () => {
    expect(isTransientSqliteError({ code: 'SQLITE_BUSY', message: 'database is locked' })).toBe(true);
  });

  it('detects nested sqlite errcode', () => {
    expect(isTransientSqliteError({ errcode: 5, message: 'database is locked' })).toBe(true);
  });

  it('detects disk I/O sqlite errors', () => {
    expect(isTransientSqliteError({ errcode: 10, message: 'disk I/O error' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isTransientSqliteError(new Error('ENOENT: no such file'))).toBe(false);
    expect(isTransientSqliteError(null)).toBe(false);
  });
});
