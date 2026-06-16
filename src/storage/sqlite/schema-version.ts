import type { DatabaseSync } from 'node:sqlite';

export const SCHEMA_META_SCHEMA_VERSION_KEY = 'schema_version';

type TableInfoRow = {
  name: string;
};

export function ensureSchemaMetaTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function readSchemaVersion(db: DatabaseSync): number {
  const row = db
    .prepare(`SELECT value FROM schema_meta WHERE key = ?`)
    .get(SCHEMA_META_SCHEMA_VERSION_KEY) as { value?: string } | undefined;
  if (!row?.value) {
    return 0;
  }
  const parsed = Number.parseInt(row.value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function setSchemaVersion(db: DatabaseSync, version: number): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid schema version: ${version}`);
  }
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
