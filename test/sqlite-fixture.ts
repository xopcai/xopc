import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ensureXopcDatabaseSchema } from '../src/storage/sqlite/schema.js';

// Vitest isolates modules per test file, so this never survives a watch rerun.
let emptyDatabase: Buffer | undefined;

function buildEmptyDatabase(): Buffer {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-test-schema-'));
  const pathname = join(directory, 'empty.db');
  try {
    const db = new DatabaseSync(pathname);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      ensureXopcDatabaseSchema(db);
    } finally {
      db.close();
    }
    return readFileSync(pathname);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Seed an independent empty database for business tests; never use for migration tests. */
export function seedTestDatabase(pathname: string): void {
  emptyDatabase ??= buildEmptyDatabase();
  mkdirSync(dirname(pathname), { recursive: true, mode: 0o700 });
  // Fail on accidental reuse instead of overwriting a live database or recovery fixture.
  writeFileSync(pathname, emptyDatabase, { flag: 'wx', mode: 0o600 });
}
