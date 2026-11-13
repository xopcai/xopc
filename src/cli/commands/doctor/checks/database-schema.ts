import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { requireNodeSqlite } from '../../../../infra/node-sqlite.js';
import { XOPC_DB_FILENAME } from '../../../../storage/sqlite/paths.js';
import {
  readSchemaVersion,
  XOPC_DB_MINIMUM_SCHEMA_VERSION,
  XOPC_DB_SCHEMA_VERSION,
} from '../../../../storage/sqlite/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkDatabaseSchema(ctx: DoctorContext): Promise<CheckResult> {
  const result = { id: 'database-schema', label: 'Database schema' };
  const path = join(ctx.stateDir, XOPC_DB_FILENAME);
  if (!existsSync(path)) {
    return { ...result, status: 'skip', message: 'No SQLite database found.', hints: [] };
  }

  let version: number;
  try {
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const hasMetadata = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_meta'").get();
      version = hasMetadata ? readSchemaVersion(db) : 0;
    } finally {
      db.close();
    }
  } catch {
    return { ...result, status: 'fail', message: 'Could not read the SQLite schema version.', hints: [path] };
  }

  if (!version) {
    return { ...result, status: 'fail', message: 'SQLite database has no valid xopc schema version.', hints: [path] };
  }
  if (version < XOPC_DB_MINIMUM_SCHEMA_VERSION) {
    return {
      ...result,
      status: 'fail',
      message: `SQLite schema v${version} is older than the minimum supported upgrade version (v${XOPC_DB_MINIMUM_SCHEMA_VERSION}).`,
      hints: ['Back up the entire state directory. See https://xopcai.github.io/xopc/update#database-upgrades for recovery.'],
    };
  }
  if (version > XOPC_DB_SCHEMA_VERSION) {
    return {
      ...result,
      status: 'fail',
      message: `SQLite schema v${version} is newer than this release supports (v${XOPC_DB_SCHEMA_VERSION}).`,
      hints: ['Use an xopc release that supports this database.'],
    };
  }
  if (version < XOPC_DB_SCHEMA_VERSION) {
    return {
      ...result,
      status: 'warn',
      message: `SQLite schema v${version} needs an upgrade to v${XOPC_DB_SCHEMA_VERSION}.`,
      hints: ['Stop other xopc processes using the database before starting Gateway.'],
    };
  }
  return {
    ...result,
    status: 'pass',
    message: `SQLite schema v${version} (current release v${XOPC_DB_SCHEMA_VERSION}).`,
    hints: [],
  };
}
