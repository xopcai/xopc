import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { seedTestDatabase } from '../../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase } from '../connection.js';
import { readSchemaVersion, XOPC_DB_SCHEMA_VERSION } from '../schema.js';

describe('test database fixture', () => {
  const directories: string[] = [];
  afterEach(() => {
    closeXopcDatabase();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function destination() {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-fixture-check-'));
    directories.push(directory);
    return join(directory, 'nested', 'xopc.db');
  }

  it('contains the current schema and passes SQLite integrity checks', () => {
    const pathname = destination();
    seedTestDatabase(pathname);
    const { db } = openXopcDatabase({ path: pathname });
    expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
  });

  it('isolates test writes and does not replace an existing database', () => {
    const first = destination();
    const second = destination();
    seedTestDatabase(first);
    const db = new DatabaseSync(first);
    try {
      db.exec('CREATE TABLE fixture_marker (value TEXT); INSERT INTO fixture_marker VALUES (\'keep\')');
      expect(() => seedTestDatabase(first)).toThrow();
      expect(db.prepare('SELECT value FROM fixture_marker').get()).toEqual({ value: 'keep' });
    } finally {
      db.close();
    }
    seedTestDatabase(second);
    const { db: other } = openXopcDatabase({ path: second });
    expect(other.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture_marker'").all()).toEqual([]);
  });
});
