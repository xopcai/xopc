import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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
        'automations',
        'automation_runs',
        'proactive_events',
        'proactive_signal_batches',
        'proactive_batch_events',
        'proactive_scenario_subscriptions',
        'proactive_runs',
        'proactive_insights',
        'proactive_inbox_items',
        'notes',
        'memory_files',
        'memory_chunks',
        'local_apps',
        'local_app_releases',
        'local_app_acceptance_runs',
        'tasks',
        'task_contracts',
        'task_runs',
        'task_run_events',
        'task_run_receipts',
        'task_waits',
        'context_edges',
        'task_authority_grants',
        'domain_outbox',
        'context_snapshots',
        'relationship_settings',
        'interaction_states',
        'user_profiles',
        'user_understandings',
        'collaboration_rules',
        'context_runs',
        'context_run_items',
        'context_consolidation_runs',
        'context_consolidation_decisions',
        'execution_environments',
        'execution_environment_bindings',
        'execution_environment_events',
      ]),
    );
    expect(tables).not.toContain('work_understanding_threads');
    expect(tables).not.toContain('focus_watches');
    expect(tables).not.toContain('compaction_checkpoints');
    expect(tables).not.toContain('checkpoint_entries');
    expect(tables).not.toContain('dreaming_runs');
    expect(tables).not.toContain('dreaming_decisions');
  });

  it('sets restrictive permissions on database files', () => {
    openXopcDatabase({ path: dbPath });
    closeXopcDatabase();

    expect(existsSync(dbPath)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    }
  });

  it('creates a pre-cutover backup and migration report for schema 100', () => {
    openXopcDatabase({ path: dbPath });
    const files = readdirSync(stateDir);
    const backup = files.find((name) => name.startsWith('xopc.db.pre-v100-') && name.endsWith('.bak'));
    expect(backup).toBeTypeOf('string');
    const report = JSON.parse(readFileSync(join(stateDir, `${backup}.report.json`), 'utf8')) as Record<string, unknown>;
    expect(report).toMatchObject({ fromVersion: 99, targetVersion: 100, status: 'succeeded' });
    if (process.platform !== 'win32') {
      expect(statSync(join(stateDir, backup!)).mode & 0o777).toBe(0o600);
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
