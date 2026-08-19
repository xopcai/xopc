import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import { validateMigrationSequence } from '../migrations/discover.js';
import {
  DatabaseSchemaMigrationGapError,
  DatabaseSchemaTooNewError,
} from '../migrations/errors.js';
import {
  applyPendingMigrations,
  inspectSchemaMigrationStatus,
  XOPC_DB_SCHEMA_VERSION,
} from '../migrations/runner.js';
import {
  ensureSchemaMetaTable,
  readSchemaVersion,
  setSchemaVersion,
} from '../schema-version.js';
import { ensureXopcDatabaseSchema } from '../schema.js';

const { DatabaseSync } = requireNodeSqlite();

function openEmptyDb(): InstanceType<typeof DatabaseSync> {
  return new DatabaseSync(':memory:');
}

describe('SQLite migrations', () => {
  let migrationsDir: string;

  beforeEach(() => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'xopc-sqlite-migrations-'));
  });

  afterEach(() => {
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('validateMigrationSequence rejects gaps in target versions', () => {
    expect(() =>
      validateMigrationSequence([
        { targetVersion: 2, filename: '002_a.sql', sql: '' },
        { targetVersion: 4, filename: '004_b.sql', sql: '' },
      ]),
    ).toThrow(/sequence gap/);
  });

  it('applyPendingMigrations runs sequential SQL files and bumps schema_meta', () => {
    writeFileSync(
      join(migrationsDir, '002_add_probe.sql'),
      `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);`,
    );
    writeFileSync(
      join(migrationsDir, '003_add_probe_meta.sql'),
      `CREATE TABLE migration_probe_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    );

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    const finalVersion = applyPendingMigrations(db, {
      migrationsDir,
      targetVersion: 3,
    });

    expect(finalVersion).toBe(3);
    expect(readSchemaVersion(db)).toBe(3);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'`).get(),
    ).toBeDefined();
  });

  it('rolls back a failed migration and leaves schema version unchanged', () => {
    writeFileSync(
      join(migrationsDir, '002_bad.sql'),
      `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);
       INSERT INTO migration_probe VALUES (1);
       INSERT INTO nonexistent_table VALUES (1);`,
    );

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    expect(() =>
      applyPendingMigrations(db, { migrationsDir, targetVersion: 2 }),
    ).toThrow(/migration to v2.*failed/i);
    expect(readSchemaVersion(db)).toBe(1);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'`).get(),
    ).toBeUndefined();
  });

  it('throws when database schema is newer than the app supports', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 99);

    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 1 })).toThrow(
      DatabaseSchemaTooNewError,
    );
  });

  it('throws when a required migration file is missing', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 2 })).toThrow(
      DatabaseSchemaMigrationGapError,
    );
  });

  it('inspectSchemaMigrationStatus reports pending versions without mutating', () => {
    writeFileSync(
      join(migrationsDir, '002_add_probe.sql'),
      `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);`,
    );

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);

    const status = inspectSchemaMigrationStatus(db, { migrationsDir, targetVersion: 2 });
    expect(status.pendingVersions).toEqual([2]);
    expect(status.hasMigrationGap).toBe(false);
    expect(readSchemaVersion(db)).toBe(1);
  });

  it('ensureXopcDatabaseSchema applies baseline then leaves version at release target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-schema-'));
    const dbPath = join(dir, 'xopc.db');
    const db = new DatabaseSync(dbPath);
    try {
      ensureXopcDatabaseSchema(db);
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'discussion_captures'`,
      ).get()).toEqual({ name: 'discussion_captures' });
      expect(db.prepare(
        `SELECT scenario_key FROM proactive_scenarios WHERE scenario_key = 'discussion_follow_up'`,
      ).get()).toEqual({ scenario_key: 'discussion_follow_up' });
      expect(db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'discussion_action_conversions'`,
      ).get()).toBeUndefined();
      expect(db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'discussion_transcript_segments'`,
      ).get()).toEqual({ name: 'discussion_transcript_segments' });
      expect(db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'discussion_capture_settings'`,
      ).get()).toEqual({ name: 'discussion_capture_settings' });
      expect(db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'execution_receipts'`,
      ).get()).toEqual({ name: 'execution_receipts' });
      expect(
        (db.prepare(`SELECT name FROM pragma_table_info('execution_receipts')`).all() as Array<{ name: string }>)
          .map((column) => column.name),
      ).toContain('judgment_json');
      expect(
        (db.prepare(`SELECT name FROM pragma_table_info('tasks')`).all() as Array<{ name: string }>)
          .map((column) => column.name),
      ).toContain('approved_boundaries_json');
      expect(db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outcome_execution_state'`,
      ).get()).toBeUndefined();
      for (const removedTable of [
        'task_outcomes',
        'goal_contracts',
        'goal_evidence_requirements',
        'goal_evidence_requirement_links',
        'goals',
        'goal_queue',
        'goal_checklist_items',
        'goal_runs',
        'goal_events',
        'goal_evidence',
        'goal_session_links',
        'goal_context_messages',
        'work_intakes',
        'outcomes',
        'outcome_contracts',
        'outcome_links',
        'outcome_queue',
      ]) {
        expect(db.prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        ).get(removedTable)).toBeUndefined();
      }
      for (const table of ['execution_receipts', 'workflow_runs']) {
        const columns = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).not.toContain('goal_id');
      }
      expect(
        (db.prepare(`SELECT name FROM pragma_table_info('workflow_runs')`).all() as Array<{ name: string }>)
          .map((column) => column.name),
      ).toContain('task_id');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades v64 knowledge item identity without losing dependent evidence', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE memory_records (record_id TEXT PRIMARY KEY);
      CREATE TABLE user_claims (claim_id TEXT PRIMARY KEY);
      CREATE TABLE knowledge_source_items (
        item_id TEXT PRIMARY KEY,
        source_instance_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        author_role TEXT,
        occurred_at INTEGER,
        source_updated_at INTEGER,
        content_hash TEXT NOT NULL,
        normalized_text TEXT,
        payload_ref TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        retention_class TEXT NOT NULL DEFAULT 'bounded',
        synthesis_status TEXT NOT NULL DEFAULT 'pending',
        deleted_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        synthesis_pipeline TEXT NOT NULL DEFAULT 'user_understanding',
        synthesis_attempts INTEGER NOT NULL DEFAULT 0,
        synthesis_claimed_at INTEGER,
        synthesis_claimed_by TEXT,
        synthesis_error TEXT,
        collection_scope TEXT NOT NULL DEFAULT 'primary',
        UNIQUE(source_instance_id, external_id)
      );
      CREATE TABLE memory_evidence (
        evidence_id TEXT PRIMARY KEY, record_id TEXT NOT NULL, source_item_id TEXT,
        relation TEXT NOT NULL, excerpt TEXT, confidence REAL, observed_at INTEGER, created_at INTEGER NOT NULL,
        FOREIGN KEY(record_id) REFERENCES memory_records(record_id) ON DELETE CASCADE,
        FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE SET NULL
      );
      CREATE TABLE knowledge_source_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL UNIQUE,
        source_instance_id TEXT NOT NULL, source_item_id TEXT NOT NULL,
        change_kind TEXT NOT NULL, old_hash TEXT, new_hash TEXT, changed_at INTEGER NOT NULL,
        FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE
      );
      CREATE TABLE user_claim_evidence (
        claim_id TEXT NOT NULL, logical_event_key TEXT NOT NULL, source_item_id TEXT NOT NULL,
        source_instance_id TEXT NOT NULL, relation TEXT NOT NULL, observed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(claim_id, logical_event_key),
        FOREIGN KEY(claim_id) REFERENCES user_claims(claim_id) ON DELETE CASCADE,
        FOREIGN KEY(source_item_id) REFERENCES knowledge_source_items(item_id) ON DELETE CASCADE
      );
      INSERT INTO memory_records VALUES ('memory-1');
      INSERT INTO user_claims VALUES ('claim-1');
      INSERT INTO knowledge_source_items (
        item_id, source_instance_id, collection_scope, external_id, item_type, content_hash, created_at, updated_at
      ) VALUES ('item-1', 'github:work', 'repositories', '123', 'repository', 'hash-1', 1, 1);
      INSERT INTO memory_evidence VALUES ('evidence-1', 'memory-1', 'item-1', 'supports', NULL, 0.8, 1, 1);
      INSERT INTO knowledge_source_changes (
        change_id, source_instance_id, source_item_id, change_kind, changed_at
      ) VALUES ('change-1', 'github:work', 'item-1', 'added', 1);
      INSERT INTO user_claim_evidence VALUES ('claim-1', 'event-1', 'item-1', 'github:work', 'supports', 1, 1);
    `);
    setSchemaVersion(db, 64);

    expect(applyPendingMigrations(db, { targetVersion: 65 })).toBe(65);
    expect(db.prepare('SELECT source_item_id FROM memory_evidence').get()).toEqual({ source_item_id: 'item-1' });
    expect(db.prepare('SELECT source_item_id FROM knowledge_source_changes').get()).toEqual({ source_item_id: 'item-1' });
    expect(db.prepare('SELECT source_item_id FROM user_claim_evidence').get()).toEqual({ source_item_id: 'item-1' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_source_state'`).get())
      .toBeUndefined();
    expect(db.prepare(`SELECT dflt_value FROM pragma_table_info('knowledge_source_items')
      WHERE name = 'collection_scope'`).get()).toEqual({ dflt_value: null });
    const sourceItemsSql = db.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'knowledge_source_items'`).get() as { sql: string };
    expect(sourceItemsSql.sql).toContain('UNIQUE(source_instance_id, collection_scope, external_id)');
    expect(sourceItemsSql.sql).not.toContain('UNIQUE(source_instance_id, external_id)');
    expect(() => db.prepare(`INSERT INTO knowledge_source_items (
      item_id, source_instance_id, collection_scope, external_id, item_type, content_hash, created_at, updated_at
    ) VALUES ('item-2', 'github:work', 'authored-work', '123', 'development_activity', 'hash-2', 2, 2)`).run())
      .not.toThrow();
  });

  it('upgrades v33 trust policies to allow a global auto default', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`
      CREATE TABLE user_trust_policies (
        principal_id TEXT PRIMARY KEY,
        default_action_level TEXT NOT NULL DEFAULT 'confirm'
          CHECK (default_action_level IN ('observe', 'suggest', 'confirm')),
        updated_at TEXT NOT NULL
      );
      INSERT INTO user_trust_policies VALUES ('local-owner', 'confirm', '2026-07-19T00:00:00.000Z');
    `);
    setSchemaVersion(db, 33);

    expect(applyPendingMigrations(db, { targetVersion: 34 })).toBe(34);
    expect(() => db.prepare(`
      UPDATE user_trust_policies
      SET default_action_level = 'auto'
      WHERE principal_id = 'local-owner'
    `).run()).not.toThrow();
    expect(db.prepare(`
      SELECT default_action_level FROM user_trust_policies WHERE principal_id = 'local-owner'
    `).get()).toEqual({ default_action_level: 'auto' });
  });

  it('upgrades v35 goal contracts with measurable task storage', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`
      CREATE TABLE goals (goal_id TEXT PRIMARY KEY);
      CREATE TABLE goal_contracts (
        goal_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        objective TEXT NOT NULL,
        scope_boundary TEXT,
        evidence_plan_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE CASCADE
      );
    `);
    setSchemaVersion(db, 35);

    expect(applyPendingMigrations(db, { targetVersion: 36 })).toBe(36);
    expect(
      db.prepare(`SELECT name FROM pragma_table_info('goal_contracts') WHERE name = 'outcome_metric_json'`).get(),
    ).toEqual({ name: 'outcome_metric_json' });
  });

  it('repairs work discovery foreign keys from v43 without losing runs', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE projects (project_id TEXT PRIMARY KEY);
      CREATE TABLE sessions (session_key TEXT PRIMARY KEY);
      INSERT INTO projects VALUES ('project-1');
      INSERT INTO sessions VALUES ('session-1');
      CREATE TABLE work_discovery_runs (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT,
        root_path TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        scan_policy_version INTEGER NOT NULL,
        snapshot_summary_json TEXT,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        canceled_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE
      );
      INSERT INTO work_discovery_runs (
        id, idempotency_key, source, status, root_path, project_id, session_key,
        agent_id, model_ref, scan_policy_version, created_at
      ) VALUES (
        'run-1', 'discovery-1', 'manual_selected_directory', 'queued', '/workspace',
        'project-1', 'session-1', 'main', 'provider/model', 1, 1
      );
    `);
    setSchemaVersion(db, 43);
    db.exec('PRAGMA foreign_keys = ON');

    expect(applyPendingMigrations(db, { targetVersion: 44 })).toBe(44);
    expect(db.prepare(`SELECT id FROM work_discovery_runs`).all()).toEqual([{ id: 'run-1' }]);
    expect(db.prepare(`PRAGMA foreign_key_list('work_discovery_runs')`).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'projects', from: 'project_id', to: 'project_id' }),
        expect.objectContaining({ table: 'sessions', from: 'session_key', to: 'session_key' }),
      ]),
    );

    db.prepare(`DELETE FROM projects WHERE project_id = ?`).run('project-1');
    expect(db.prepare(`SELECT id FROM work_discovery_runs`).get()).toBeUndefined();
  });

  it('adds persistent work discovery recognition feedback', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE projects (project_id TEXT PRIMARY KEY);
      CREATE TABLE sessions (session_key TEXT PRIMARY KEY);
      CREATE TABLE work_discovery_runs (id TEXT PRIMARY KEY);
    `);
    setSchemaVersion(db, 45);
    db.exec('PRAGMA foreign_keys = ON');

    expect(applyPendingMigrations(db, { targetVersion: 46 })).toBe(46);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_discovery_feedback'`).get())
      .toEqual({ name: 'work_discovery_feedback' });
    expect(db.prepare(`PRAGMA foreign_key_list('work_discovery_feedback')`).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'work_discovery_runs', from: 'run_id', to: 'id' }),
      ]),
    );
  });

  it('adds persistent work discovery sources', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`CREATE TABLE projects (project_id TEXT PRIMARY KEY);`);
    setSchemaVersion(db, 46);

    expect(applyPendingMigrations(db, { targetVersion: 50 })).toBe(50);
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_discovery_sources'`,
    ).get()).toEqual({ name: 'work_discovery_sources' });
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_understanding_investigations'`,
    ).get()).toEqual({ name: 'work_understanding_investigations' });
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_understanding_evidence'`,
    ).get()).toEqual({ name: 'work_understanding_evidence' });
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_understanding_threads'`,
    ).get()).toEqual({ name: 'work_understanding_threads' });
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_understanding_thread_feedback'`,
    ).get()).toEqual({ name: 'work_understanding_thread_feedback' });
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_discovery_source_refreshes'`,
    ).get()).toEqual({ name: 'work_discovery_source_refreshes' });
  });

  it('upgrades v21 databases with first-class work item tables', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    db.exec(`
      CREATE TABLE goals (
        goal_id TEXT PRIMARY KEY
      );
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        default_agent_id TEXT,
        workspace_root TEXT,
        brief TEXT,
        instructions TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER
      );
      CREATE TABLE sessions (
        session_key TEXT PRIMARY KEY
      );
      CREATE TABLE automations (
        automation_id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL,
        trigger_json TEXT NOT NULL, action_json TEXT NOT NULL, state_json TEXT NOT NULL DEFAULT '{}',
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
      );
      INSERT INTO automations (
        automation_id, name, enabled, trigger_json, action_json, created_at_ms, updated_at_ms
      ) VALUES (
        'system-dreaming:research:deep', 'Legacy dreaming', 1, '{}', '{}', 1, 1
      );
      CREATE TABLE memory_records (
        record_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, kind TEXT NOT NULL,
        agent_id TEXT NOT NULL, workspace_id TEXT, session_key TEXT, project_id TEXT, content TEXT NOT NULL,
        source_json TEXT NOT NULL, confidence REAL, tags_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_recalled_at INTEGER,
        recall_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
        sensitivity TEXT NOT NULL DEFAULT 'normal', evidence_json TEXT NOT NULL DEFAULT '[]',
        review_after INTEGER, expires_at INTEGER
      );
      CREATE VIRTUAL TABLE memory_records_fts USING fts5(
        content, record_id UNINDEXED, provider_id UNINDEXED, kind UNINDEXED,
        agent_id UNINDEXED, workspace_id UNINDEXED
      );
      CREATE TABLE memory_signals (
        signal_id TEXT PRIMARY KEY, source TEXT NOT NULL, record_id TEXT, provider_id TEXT,
        agent_id TEXT, workspace_id TEXT, session_key TEXT, score REAL, content TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
      );
      CREATE TABLE memory_trace_events (
        trace_id TEXT PRIMARY KEY, session_key TEXT, turn_id TEXT, phase TEXT NOT NULL,
        provider_id TEXT NOT NULL, request_json TEXT NOT NULL DEFAULT '{}', result_count INTEGER,
        selected_record_ids_json TEXT NOT NULL DEFAULT '[]', skipped_reason TEXT, error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        feedback_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE memory_files (
        file_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, path TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL, content_hash TEXT NOT NULL, UNIQUE(agent_id, path)
      );
      CREATE TABLE memory_chunks (
        chunk_id TEXT PRIMARY KEY, file_id TEXT NOT NULL, start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL, content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        content, chunk_id UNINDEXED, agent_id UNINDEXED, path UNINDEXED,
        start_line UNINDEXED, end_line UNINDEXED
      );
    `);
    setSchemaVersion(db, 21);

    const finalVersion = applyPendingMigrations(db, { targetVersion: 59 });

    expect(finalVersion).toBe(59);
    expect(readSchemaVersion(db)).toBe(59);
    expect(db.prepare(`SELECT automation_id FROM automations WHERE automation_id LIKE 'system-dreaming%'`).get()).toBeUndefined();
    for (const table of [
      'work_items',
      'work_item_links',
      'work_item_events',
      'work_item_attachments',
      'work_item_update_suggestions',
    ]) {
      expect(
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
      ).toBeDefined();
    }
  });

  it('removes persisted runtime-only messages and unsafe compaction rows at v60', () => {
    const db = openEmptyDb();
    ensureXopcDatabaseSchema(db);
    db.exec(`
      INSERT INTO sessions (
        session_key, agent_id, session_id, created_at, updated_at, last_accessed_at,
        message_count, estimated_tokens
      ) VALUES ('agent:main:webchat:default:direct:cleanup', 'main', 'session-cleanup', 1, 1, 1, 3, 100);
      INSERT INTO transcripts (session_id, session_key, status, created_at, cwd)
      VALUES ('session-cleanup', 'agent:main:webchat:default:direct:cleanup', 'active', 1, '/tmp');
      INSERT INTO transcript_entries VALUES
        ('entry-normal', 'session-cleanup', 1, 'message', 'user',
          '{"role":"user","content":"keep"}', 1),
        ('entry-runtime', 'session-cleanup', 2, 'message', 'user',
          '{"role":"user","content":"<coding_context>leak</coding_context>","droppable":true}', 2),
        ('entry-compaction', 'session-cleanup', 3, 'compaction', NULL,
          '{"type":"compaction","messages":[]}', 3);
      INSERT INTO transcript_fts (content, session_key, session_id, entry_id) VALUES
        ('keep', 'agent:main:webchat:default:direct:cleanup', 'session-cleanup', 'entry-normal'),
        ('leak', 'agent:main:webchat:default:direct:cleanup', 'session-cleanup', 'entry-runtime');
    `);
    setSchemaVersion(db, 59);

    expect(applyPendingMigrations(db, { targetVersion: 60 })).toBe(60);
    expect(db.prepare(`SELECT entry_id FROM transcript_entries ORDER BY seq`).all()).toEqual([
      { entry_id: 'entry-normal' },
    ]);
    expect(db.prepare(`SELECT entry_id FROM transcript_fts`).all()).toEqual([
      { entry_id: 'entry-normal' },
    ]);
    expect(db.prepare(`SELECT message_count FROM sessions WHERE session_id = 'session-cleanup'`).get())
      .toEqual({ message_count: 1 });
  });

  it('drops legacy checkpoint tables at v61', () => {
    const db = openEmptyDb();
    ensureXopcDatabaseSchema(db);
    db.exec(`
      CREATE TABLE compaction_checkpoints (
        checkpoint_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, session_key TEXT NOT NULL,
        created_at INTEGER NOT NULL, message_count INTEGER NOT NULL, size_bytes INTEGER NOT NULL
      );
      CREATE TABLE checkpoint_entries (
        checkpoint_id TEXT NOT NULL, seq INTEGER NOT NULL, entry_kind TEXT NOT NULL,
        role TEXT, payload_json TEXT NOT NULL, PRIMARY KEY (checkpoint_id, seq)
      );
    `);
    setSchemaVersion(db, 60);

    expect(applyPendingMigrations(db, { targetVersion: 61 })).toBe(61);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?) ORDER BY name`,
    ).all('compaction_checkpoints', 'checkpoint_entries');
    expect(tables).toEqual([]);
  });

  it('keeps only the Task work model in the current schema', () => {
    const db = openEmptyDb();
    ensureXopcDatabaseSchema(db);

    expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    const removedTables = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'work_item%'
       ORDER BY name`,
    ).all();
    expect(removedTables).toEqual([]);

    const receiptColumns = db.prepare(`PRAGMA table_info(execution_receipts)`).all() as Array<{ name: string }>;
    expect(receiptColumns.map((column) => column.name)).not.toContain('work_item_id');
    expect(receiptColumns.map((column) => column.name)).not.toContain('outcome_id');
    expect(receiptColumns.map((column) => column.name)).toContain('task_id');
    expect(receiptColumns.map((column) => column.name)).toContain('feedback_rating');
    const taskColumns = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
    expect(taskColumns.map((column) => column.name)).toContain('approved_boundaries_json');
    expect(taskColumns.map((column) => column.name)).not.toContain('user_status');
    expect(taskColumns.map((column) => column.name)).not.toContain('internal_status');
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_execution_state'`,
    ).get()).toBeUndefined();
    expect(db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies'`,
    ).get()).toEqual({ name: 'task_dependencies' });

    const blockedScenario = db.prepare(
      `SELECT event_types_json FROM proactive_scenarios WHERE scenario_key = 'blocked_work'`,
    ).get() as { event_types_json: string };
    expect(JSON.parse(blockedScenario.event_types_json)).toEqual(['task.status_changed.v1']);
  });

});
