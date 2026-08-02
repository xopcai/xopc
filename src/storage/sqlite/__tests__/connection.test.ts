import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../connection.js';
import { resolveXopcDatabasePath } from '../paths.js';
import { readSchemaVersionForTest, XOPC_DB_SCHEMA_VERSION } from '../schema.js';

const { DatabaseSync } = requireNodeSqlite();

function listTableNames(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath);
  try {
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

describe('openXopcDatabase', () => {
  let stateDir: string;
  let dbPath: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-sqlite-'));
    dbPath = join(stateDir, 'xopc.db');
    resetXopcDatabaseSingletonForTest();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates all schema tables and sets schema version', () => {
    const opened = openXopcDatabase({ path: dbPath });
    expect(opened.path).toBe(dbPath);
    expect(readSchemaVersionForTest(opened.db)).toBe(XOPC_DB_SCHEMA_VERSION);

    const tables = listTableNames(dbPath);
    expect(tables).toEqual(
      expect.arrayContaining([
        'schema_meta',
        'sessions',
        'session_config',
        'transcripts',
        'transcript_entries',
        'compaction_checkpoints',
        'checkpoint_entries',
        'automations',
        'automation_runs',
        'focus_watches',
        'proactive_insights',
        'notes',
        'memory_files',
        'memory_chunks',
        'local_apps',
        'local_app_releases',
        'local_app_acceptance_runs',
        'task_outcomes',
        'relationship_settings',
      ]),
    );
  });

  it('sets restrictive permissions on database files', () => {
    openXopcDatabase({ path: dbPath });
    closeXopcDatabase();

    expect(existsSync(dbPath)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    }
  });

  it('returns the same singleton for repeated open calls', () => {
    const first = openXopcDatabase({ path: dbPath });
    const second = openXopcDatabase({ path: dbPath });
    expect(second).toBe(first);
  });

  it('resolveXopcDatabasePath honors XOPC_STATE_DIR', () => {
    const env = { XOPC_STATE_DIR: stateDir } as NodeJS.ProcessEnv;
    expect(resolveXopcDatabasePath(env)).toBe(dbPath);
  });
});
