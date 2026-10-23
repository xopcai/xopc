import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
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
    expect(opened.db.prepare("SELECT name FROM sqlite_master WHERE lower(coalesce(sql, '')) LIKE '%workflow%'").all()).toEqual([]);
    expect(opened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(opened.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(tables).toEqual(
      expect.arrayContaining([
        'schema_meta',
        'sessions',
        'session_config',
        'transcripts',
        'transcript_entries',
        'automations',
        'automation_runs',
        'notes',
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
        'interaction_states',
        'user_assertion_slots',
        'user_assertions',
        'user_assertion_evidence',
        'user_assertion_status_events',
        'user_goals',
        'user_goal_revisions',
        'user_priority_windows',
        'knowledge_items',
        'memory_maintenance_runs',
        'memory_maintenance_decisions',
        'execution_context_runs',
        'execution_context_items',
        'collaboration_rules',
        'execution_environments',
        'execution_environment_bindings',
        'execution_environment_events',
      ]),
    );
    expect(tables.filter((name) => /^(scene_|proactive_)/.test(name))).toEqual([]);
    expect(tables).not.toContain('work_understanding_threads');
    expect(tables).not.toContain('focus_watches');
    expect(tables).not.toContain('compaction_checkpoints');
    expect(tables).not.toContain('checkpoint_entries');
    expect(tables).not.toContain('user_profiles');
    expect(tables).not.toContain('user_understandings');
    expect(tables).not.toContain('memory_records');
    expect(tables).not.toContain('memory_files');
    expect(tables).not.toContain('memory_chunks');
    expect(tables).not.toContain('dreaming_runs');
    expect(tables).not.toContain('dreaming_decisions');
  });

  it('does not copy runtime data into another fresh database', () => {
    const first = openXopcDatabase({ path: dbPath });
    first.db.exec("CREATE TABLE runtime_only(value TEXT); INSERT INTO runtime_only VALUES ('private')");
    closeXopcDatabase();

    const secondPath = join(stateDir, 'second.db');
    const second = openXopcDatabase({ path: secondPath });
    expect(second.db.prepare("SELECT name FROM sqlite_master WHERE name = 'runtime_only'").get()).toBeUndefined();
    expect(readSchemaVersionForTest(second.db)).toBe(XOPC_DB_SCHEMA_VERSION);
  }, 30_000); // Two complete migrations and fsyncs may contend with parallel integration tests.

  it('reopens an already upgraded database without another cutover backup', () => {
    const first = openXopcDatabase({ path: dbPath });
    first.db.exec("CREATE TABLE upgrade_sentinel(value TEXT); INSERT INTO upgrade_sentinel VALUES ('preserved')");
    closeXopcDatabase();

    const beforeBackups = readdirSync(stateDir).filter((name) => name.endsWith('.bak')).toSorted();
    const reopened = openXopcDatabase({ path: dbPath });

    expect(readSchemaVersionForTest(reopened.db)).toBe(XOPC_DB_SCHEMA_VERSION);
    expect(reopened.db.prepare('SELECT value FROM upgrade_sentinel').get()?.value).toBe('preserved');
    expect(readdirSync(stateDir).filter((name) => name.endsWith('.bak')).toSorted()).toEqual(beforeBackups);
    expect(beforeBackups).toEqual([]);
  });

  it('sets restrictive permissions on database files', () => {
    openXopcDatabase({ path: dbPath });
    closeXopcDatabase();

    expect(existsSync(dbPath)).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps in-memory databases off the filesystem', () => {
    const unexpectedPath = join(process.cwd(), ':memory');
    expect(existsSync(unexpectedPath)).toBe(false);

    const opened = openXopcDatabase({ path: ':memory:' });

    expect(opened.path).toBe(':memory:');
    expect(existsSync(unexpectedPath)).toBe(false);
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
