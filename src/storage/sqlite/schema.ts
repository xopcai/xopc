import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DatabaseSync } from 'node:sqlite';

import {
  applyPendingMigrations,
  XOPC_DB_BASELINE_SCHEMA_VERSION,
  XOPC_DB_SCHEMA_VERSION,
} from './migrations/runner.js';
import {
  ensureSchemaMetaTable,
  readSchemaVersion,
  setSchemaVersion,
} from './schema-version.js';

export {
  SCHEMA_META_SCHEMA_VERSION_KEY,
  readSchemaVersionForTest,
  readSchemaVersion,
  setSchemaVersion,
  ensureSchemaMetaTable,
} from './schema-version.js';
export {
  XOPC_DB_BASELINE_SCHEMA_VERSION,
  XOPC_DB_SCHEMA_VERSION,
} from './migrations/runner.js';

const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));

function readSchemaSql(): string {
  return readFileSync(join(SCHEMA_DIR, 'schema.sql'), 'utf8');
}

function bootstrapFreshDatabase(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(readSchemaSql());
    setSchemaVersion(db, XOPC_DB_BASELINE_SCHEMA_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* preserve original error */
    }
    throw error;
  }
}

/**
 * Ensure schema_meta exists, apply baseline schema.sql on first open, then run pending migrations.
 */
export function ensureXopcDatabaseSchema(db: DatabaseSync): void {
  ensureSchemaMetaTable(db);

  let currentVersion = readSchemaVersion(db);
  if (currentVersion === 0) {
    bootstrapFreshDatabase(db);
    currentVersion = XOPC_DB_BASELINE_SCHEMA_VERSION;
  }

  applyPendingMigrations(db, { targetVersion: XOPC_DB_SCHEMA_VERSION });
}
