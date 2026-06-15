import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DatabaseSync } from 'node:sqlite';

export const XOPC_DB_SCHEMA_VERSION = 2;

export const SCHEMA_META_SCHEMA_VERSION_KEY = 'schema_version';

type TableInfoRow = {
  name: string;
};

const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));

function readSchemaSql(version: number): string {
  return readFileSync(join(SCHEMA_DIR, `schema-v${version}.sql`), 'utf8');
}

export function ensureXopcDatabaseSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const currentVersion = readSchemaVersion(db);
  if (currentVersion === 0) {
    db.exec(readSchemaSql(1));
    db.exec(readSchemaSql(2));
    setSchemaVersion(db, XOPC_DB_SCHEMA_VERSION);
    return;
  }

  if (currentVersion === 1) {
    db.exec(readSchemaSql(2));
    setSchemaVersion(db, XOPC_DB_SCHEMA_VERSION);
    return;
  }

  if (currentVersion !== XOPC_DB_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported xopc database schema version ${currentVersion} (expected ${XOPC_DB_SCHEMA_VERSION})`,
    );
  }
}

function readSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare(`SELECT value FROM schema_meta WHERE key = ?`)
    .get(SCHEMA_META_SCHEMA_VERSION_KEY) as { value?: string } | undefined;
  if (!row?.value) {
    return 0;
  }
  const parsed = Number.parseInt(row.value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SCHEMA_META_SCHEMA_VERSION_KEY, String(version));
}

export function readSchemaVersionForTest(db: DatabaseSync): number {
  const rows = db.prepare(`PRAGMA table_info(schema_meta)`).all() as TableInfoRow[];
  if (rows.length === 0) {
    return 0;
  }
  return readSchemaVersion(db);
}
