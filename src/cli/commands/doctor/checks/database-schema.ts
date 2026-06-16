import { existsSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import {
  inspectSchemaMigrationStatus,
  XOPC_DB_SCHEMA_VERSION,
} from '../../../../storage/sqlite/migrations/runner.js';
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
  const status = inspectSchemaMigrationStatus(getSqliteDatabase());

  if (status.isTooNew) {
    return {
      id: 'database-schema',
      label: 'Database schema',
      status: 'fail',
      message: `Database schema v${status.dbVersion} is newer than this app (v${status.appVersion}).`,
      hints: [
        'Upgrade xopc to a newer release that supports this database version.',
        'Or restore xopc.db from a backup taken before the upgrade.',
      ],
    };
  }

  if (status.hasMigrationGap) {
    return {
      id: 'database-schema',
      label: 'Database schema',
      status: 'fail',
      message: `Database schema v${status.dbVersion} is missing migration to v${status.missingVersion}.`,
      hints: [
        `This app supports schema v${status.appVersion} but is missing migration file ${String(status.missingVersion).padStart(3, '0')}_*.sql.`,
        'Upgrade xopc to a release that bundles the required migration.',
      ],
    };
  }

  if (status.pendingVersions.length > 0) {
    return {
      id: 'database-schema',
      label: 'Database schema',
      status: 'warn',
      message: `Database schema v${status.dbVersion}; pending migration to v${status.appVersion} on next gateway start.`,
      hints: [
        `Pending steps: v${status.pendingVersions.join(', v')}`,
        'Restart the gateway (or open the Electron app) to apply migrations automatically.',
      ],
    };
  }

  return {
    id: 'database-schema',
    label: 'Database schema',
    status: 'pass',
    message: `SQLite schema v${status.dbVersion} (current release v${XOPC_DB_SCHEMA_VERSION}).`,
    hints: [],
  };
}
