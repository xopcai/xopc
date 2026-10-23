import type { DatabaseSync } from 'node:sqlite';

import { memorySearchText } from '../../knowledge-memory/search-text.js';
import { currentOperationId } from '../../infra/operation-context.js';
import { readSqliteAsset } from './sql-assets.js';
import { readSchemaVersion, setSchemaVersion } from './schema-version.js';
import { DatabaseSchemaTooNewError, DatabaseSchemaTooOldError } from './schema-errors.js';

export { SCHEMA_META_SCHEMA_VERSION_KEY, readSchemaVersionForTest, readSchemaVersion, setSchemaVersion, ensureSchemaMetaTable } from './schema-version.js';

export const XOPC_DB_SCHEMA_VERSION = 259;
export const XOPC_DB_BASELINE_SCHEMA_VERSION = XOPC_DB_SCHEMA_VERSION;

/** Open only the current schema; older databases are never upgraded or interpreted. */
export function ensureXopcDatabaseSchema(db: DatabaseSync): void {
  db.function('xopc_memory_search_text', { deterministic: true }, value => memorySearchText(String(value ?? '')));
  db.function('xopc_operation_id', () => currentOperationId() ?? null);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const hasMetadata = tables.some(row => row.name === 'schema_meta');
  if (!hasMetadata && tables.length) throw new Error('An unversioned database cannot be initialized');
  const version = hasMetadata ? readSchemaVersion(db) : 0;
  if (version > XOPC_DB_SCHEMA_VERSION) throw new DatabaseSchemaTooNewError(version, XOPC_DB_SCHEMA_VERSION);
  if (version > 0 && version < XOPC_DB_SCHEMA_VERSION) throw new DatabaseSchemaTooOldError(version, XOPC_DB_SCHEMA_VERSION);
  if (version === XOPC_DB_SCHEMA_VERSION) return;
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_meta' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
  if (existing) throw new Error('An unversioned database cannot be initialized');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(readSqliteAsset('schema.sql'));
    setSchemaVersion(db, XOPC_DB_SCHEMA_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
