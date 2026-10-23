import { existsSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import { readSchemaVersion, XOPC_DB_SCHEMA_VERSION } from '../../../../storage/sqlite/schema.js';
import {
  getSqliteDatabase,
  requireXopcDatabase,
} from '../../../../storage/sqlite/index.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkDatabaseSchema(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'database-schema',
      label: 'Database schema',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  try {
    loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'database-schema',
      label: 'Database schema',
      status: 'warn',
      message: 'Config invalid; database schema check skipped.',
      hints: ['Fix xopc.json before running database checks.'],
    };
  }

  requireXopcDatabase();
  const version = readSchemaVersion(getSqliteDatabase());
  return {
    id: 'database-schema',
    label: 'Database schema',
    status: 'pass',
    message: `SQLite schema v${version} (current release v${XOPC_DB_SCHEMA_VERSION}).`,
    hints: [],
  };
}
