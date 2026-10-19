import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireNodeSqlite } from '../../../infra/node-sqlite.js';
import { validateMigrationSequence } from '../migrations/discover.js';
import {
  DatabaseSchemaMigrationGapError,
  DatabaseSchemaTooNewError,
  DatabaseSchemaTooOldError,
} from '../migrations/errors.js';
import {
  applyPendingMigrations,
  inspectSchemaMigrationStatus,
  XOPC_DB_BASELINE_SCHEMA_VERSION,
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

function installBaseline(db: InstanceType<typeof DatabaseSync>): void {
  ensureSchemaMetaTable(db);
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  setSchemaVersion(db, XOPC_DB_BASELINE_SCHEMA_VERSION);
}

describe('SQLite migrations', () => {
  let migrationsDir: string;

  beforeEach(() => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'xopc-sqlite-migrations-'));
  });

  afterEach(() => {
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('preserves legacy global composer rows without assigning them to a session', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 256 });
      db.prepare('INSERT INTO composer_input_history(text, created_at) VALUES (?, ?)').run('old global input', 1);
      applyPendingMigrations(db);
      expect(db.prepare('SELECT text FROM composer_input_history_legacy').all()).toEqual([{ text: 'old global input' }]);
      expect(db.prepare('SELECT COUNT(*) n FROM composer_input_history').get()).toEqual({ n: 0 });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });

  it('adds restartable discussion processing without changing existing audio and cascades checkpoint cleanup', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db); applyPendingMigrations(db, { targetVersion: 252 });
      db.exec("INSERT INTO notes (note_id,kind,status,payload_json,created_at,updated_at) VALUES ('note','text','active','{}',1,1)");
      db.exec("INSERT INTO discussion_captures (id,client_request_id,note_id,source,status,audio_attachment_id,recording_started_at,created_at,updated_at) VALUES ('capture','request','note','web','needs_attention','original',1,1,1)");
      applyPendingMigrations(db);
      expect(db.prepare("SELECT status,audio_attachment_id FROM discussion_captures WHERE id='capture'").get()).toEqual({ status: 'needs_attention', audio_attachment_id: 'original' });
      db.exec("INSERT INTO discussion_processing (discussion_id,run_id,base_transcript_revision) VALUES ('capture','run',0)");
      db.exec("INSERT INTO discussion_transcription_checkpoints VALUES ('run',0,20000,'{}',1)");
      db.exec("DELETE FROM discussion_processing WHERE discussion_id='capture'");
      expect(db.prepare('SELECT COUNT(*) n FROM discussion_transcription_checkpoints').get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT audio_attachment_id FROM discussion_captures WHERE id='capture'").get()).toEqual({ audio_attachment_id: 'original' });
    } finally { db.close(); }
  });

  it('moves historical personal thinking settings into the dedicated session', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 245 });
      db.exec('PRAGMA foreign_keys = OFF');
      const insertAgent = db.prepare(`INSERT INTO agents (id, enabled, overrides_json, provisioning_state, revision, created_at, updated_at)
        VALUES (?, 1, ?, 'ready', 1, 1, 1)`);
      insertAgent.run('ada', JSON.stringify({ runtime: { thinkingLevel: 'high', timeoutMs: 1000 }, models: { chat: { primary: 'test/fast' } } }));
      insertAgent.run('coder', JSON.stringify({ runtime: { thinkingLevel: 'high' } }));
      db.exec(`INSERT INTO agent_catalog_settings VALUES (1, 'coder', '{}', 1, 1, 1)`);
      const insertSession = db.prepare(`INSERT INTO sessions (conversation_id, agent_id, active_transcript_id, created_at, updated_at, last_accessed_at, custom_data_json)
        VALUES (?, ?, ?, 1, 1, 1, ?)`);
      insertSession.run('personal', 'ada', 'personal-transcript', '{"personalAgent":true}');
      insertSession.run('personal-missing', 'ada', 'missing-transcript', '{"personalAgent":true}');
      insertSession.run('ordinary-ada', 'ada', 'ordinary-transcript', '{}');
      insertSession.run('ordinary-coder', 'coder', 'coder-transcript', '{}');
      db.exec(`INSERT INTO session_config (conversation_id, thinking_level, model_override, updated_at)
        VALUES ('personal', 'off', 'test/other', 10), ('ordinary-ada', 'medium', 'test/fast', 10)`);
      applyPendingMigrations(db);
      expect(db.prepare(`SELECT thinking_level, model_override, updated_at FROM session_config WHERE conversation_id = 'personal'`).get())
        .toEqual({ thinking_level: 'off', model_override: 'test/other', updated_at: 10 });
      expect(db.prepare(`SELECT thinking_level FROM session_config WHERE conversation_id = 'personal-missing'`).get())
        .toEqual({ thinking_level: 'high' });
      expect(db.prepare(`SELECT thinking_level FROM session_config WHERE conversation_id = 'ordinary-ada'`).get())
        .toEqual({ thinking_level: 'medium' });
      const overrides = JSON.parse((db.prepare(`SELECT overrides_json FROM agents WHERE id = 'ada'`).get() as { overrides_json: string }).overrides_json);
      expect(overrides.runtime).toEqual({ timeoutMs: 1000 });
      expect(overrides.models.chat.primary).toBe('test/fast');
      expect(db.prepare(`SELECT json_extract(overrides_json, '$.runtime.thinkingLevel') AS thinking FROM agents WHERE id = 'coder'`).get())
        .toEqual({ thinking: 'high' });
      expect(db.prepare(`SELECT revision FROM agent_catalog_settings`).get()).toEqual({ revision: 2 });
    } finally { db.close(); }
  });

  it('adds reply state directly to the existing outbox while preserving artifact deliveries', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 233 });
      // This isolated migration test needs no execution fixture.
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare(`INSERT INTO task_result_deliveries
        (delivery_id, task_run_id, conversation_id, payload_json, status, message_entry_id,
          next_attempt_at, created_at, notified_at)
        VALUES ('artifact', 'run-1', 'chat-1', '{}', 'delivered', 'artifact-entry', 0, 1, 10)`).run();
      applyPendingMigrations(db);
      expect(db.prepare(`SELECT delivery_id, status, message_entry_id, notified_at, reply_status,
        reply_text, reply_notified_at, reply_attempts, reply_next_attempt_at, reply_lease_until
        FROM task_result_deliveries`).all()).toEqual([
        { delivery_id: 'artifact', status: 'delivered', message_entry_id: 'artifact-entry', notified_at: 10,
          reply_status: null, reply_text: null, reply_notified_at: null,
          reply_attempts: 0, reply_next_attempt_at: 0, reply_lease_until: 0 },
      ]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'personal_reply_jobs'").get()).toBeUndefined();
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
    } finally { db.close(); }
  });

  it('adds home intelligence queues, projections, and append-only feedback', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db);
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name IN ('home_advice_generations', 'home_opportunity_feedback', 'home_opportunity_projections')
        ORDER BY name`).all().map((row) => row.name);
      expect(tables).toEqual([
        'home_advice_generations',
        'home_opportunity_feedback',
        'home_opportunity_projections',
      ]);
      expect(db.prepare(`SELECT name, "notnull", dflt_value FROM pragma_table_info('home_advice_generations')
        WHERE name = 'strategy_version'`).get()).toEqual({
        name: 'strategy_version', notnull: 1, dflt_value: "'home-v1'",
      });
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });

  it('adds the consent-aware personal-model contract', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db);
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
        AND name IN ('understanding_consent_receipts', 'user_model_observations', 'user_assertion_edges')
        ORDER BY name`).all().map((row) => row.name)).toEqual([
        'understanding_consent_receipts', 'user_assertion_edges', 'user_model_observations',
      ]);
      expect(db.prepare(`SELECT name FROM pragma_table_info('user_assertions')
        WHERE name IN ('domain', 'model_layer', 'purpose_ids_json', 'allowed_uses_json', 'support_count')
        ORDER BY name`).all().map((row) => row.name)).toEqual([
        'allowed_uses_json', 'domain', 'model_layer', 'purpose_ids_json', 'support_count',
      ]);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });

  it('migrates the retained v217 baseline to the current registered version', () => {
    expect(XOPC_DB_BASELINE_SCHEMA_VERSION).toBe(217);
    expect(XOPC_DB_SCHEMA_VERSION).toBeGreaterThan(XOPC_DB_BASELINE_SCHEMA_VERSION);

    const db = openEmptyDb();
    try {
      installBaseline(db);
      expect(applyPendingMigrations(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capability_imports'").get())
        .toEqual({ name: 'capability_imports' });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_routes'").get())
        .toEqual({ name: 'conversation_routes' });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'knowledge_item_status_events'").get())
        .toEqual({ name: 'knowledge_item_status_events' });
    } finally {
      db.close();
    }
  });

  it('backfills durable main Agent ownership from existing delegated Tasks', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 227 });
      const conversationId = '1ca1490a-8918-47e0-b03a-63dcc15d46e2';
      db.prepare(`INSERT INTO sessions (conversation_id, agent_id, active_transcript_id,
        created_at, updated_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(conversationId, 'main', 'transcript-1', 1, 1, 1);
      db.prepare(`INSERT INTO tasks (task_id, title, phase, priority, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run('task-1', 'Research', 'active', 'normal', 'api', 1, 1);
      db.prepare(`INSERT INTO task_origin_links (task_id, conversation_id, created_at)
        VALUES (?, ?, ?)`).run('task-1', conversationId, 1);
      applyPendingMigrations(db);
      expect(db.prepare(`SELECT agent_id, origin_conversation_id FROM task_main_agent_links
        WHERE task_id = ?`).get('task-1')).toEqual({ agent_id: 'main', origin_conversation_id: conversationId });
      db.prepare('DELETE FROM sessions WHERE conversation_id = ?').run(conversationId);
      expect(db.prepare('SELECT agent_id FROM task_main_agent_links WHERE task_id = ?').get('task-1'))
        .toEqual({ agent_id: 'main' });
    } finally { db.close(); }
  });

  it('bootstraps a fresh database at the release target', () => {
    const db = openEmptyDb();
    try {
      ensureXopcDatabaseSchema(db);
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'proactive_*'").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('adds indexes for high-value relation lookups', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db);
      const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'
        AND name IN (
          'idx_task_runs_contract',
          'idx_task_runs_conversation',
          'idx_connector_execution_audit_connection',
          'idx_knowledge_source_changes_item',
          'idx_notification_deliveries_device'
        ) ORDER BY name`).all().map((row) => row.name);
      expect(names).toEqual([
        'idx_connector_execution_audit_connection',
        'idx_knowledge_source_changes_item',
        'idx_notification_deliveries_device',
        'idx_task_runs_contract',
        'idx_task_runs_conversation',
      ]);
    } finally {
      db.close();
    }
  });

  it('enforces JSON contracts at the database boundary', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 219 });

      expect(() => db.prepare(`INSERT INTO automations (
        automation_id, name, enabled, trigger_json, action_json, state_json,
        created_at_ms, updated_at_ms, delivery_json
      ) VALUES ('invalid', 'Invalid', 1, 'not-json', '{}', '{}', 1, 1, '{}')`).run())
        .toThrow();
      expect(() => db.prepare(`INSERT INTO ai_usage_events (
        id, trace_id, category, operation, trigger_kind, reason_key, provider, model,
        status, started_at, cost_source, pricing_snapshot_json, created_at, updated_at
      ) VALUES ('invalid', 'trace', 'agent', 'turn', 'user', 'test', 'provider', 'model',
        'succeeded', 1, 'unknown', 'not-json', 1, 1)`).run()).toThrow();
    } finally {
      db.close();
    }
  });

  it('normalizes remaining persisted timestamps to epoch milliseconds', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 219 });
      db.prepare(`INSERT INTO connector_catalog_entries (
        connector_id, provider, definition_json, fetched_at, expires_at
      ) VALUES ('mail', 'composio', '{}', ?, ?)`)
        .run('2026-09-26T01:02:03.456Z', '2026-09-27T01:02:03.456Z');
      db.prepare(`INSERT INTO user_trust_policies (
        principal_id, default_action_level, updated_at
      ) VALUES ('owner', 'confirm', ?)`)
        .run('2026-09-26T01:02:03.456Z');

      applyPendingMigrations(db, { targetVersion: 220 });

      expect(db.prepare(`SELECT fetched_at, expires_at FROM connector_catalog_entries
        WHERE connector_id = 'mail'`).get()).toEqual({
        fetched_at: Date.parse('2026-09-26T01:02:03.456Z'),
        expires_at: Date.parse('2026-09-27T01:02:03.456Z'),
      });
      expect(db.prepare(`SELECT updated_at FROM user_trust_policies
        WHERE principal_id = 'owner'`).get()).toEqual({
        updated_at: Date.parse('2026-09-26T01:02:03.456Z'),
      });
      expect(db.prepare(`SELECT type FROM pragma_table_info('connector_connections')
        WHERE name = 'connected_at'`).get()).toEqual({ type: 'INTEGER' });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('makes session_config the sole authority for persisted agent levels', () => {
    const db = openEmptyDb();
    try {
      installBaseline(db);
      applyPendingMigrations(db, { targetVersion: 221 });
      db.prepare(`INSERT INTO sessions (
        conversation_id, agent_id, active_transcript_id, tags_json, created_at, updated_at,
        last_accessed_at, source_channel, source_chat_id, hidden_from_session_list,
        thinking_level, verbose_level
      ) VALUES ('conversation', 'main', 'transcript', '[]', 1, 2, 2, '', '', 0, 'high', 'full')`).run();
      db.prepare(`INSERT INTO session_config (
        conversation_id, thinking_level, updated_at
      ) VALUES ('conversation', 'low', 3)`).run();

      applyPendingMigrations(db, { targetVersion: 222 });

      expect(db.prepare(`SELECT thinking_level, verbose_level FROM session_config
        WHERE conversation_id = 'conversation'`).get()).toEqual({
        thinking_level: 'low',
        verbose_level: 'full',
      });
      expect(db.prepare(`SELECT name FROM pragma_table_info('sessions')
        WHERE name IN ('thinking_level', 'verbose_level')`).all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('rejects missing migration sequence entries', () => {
    expect(() => validateMigrationSequence([
      { targetVersion: 218, filename: '218_a.sql', sql: '' },
      { targetVersion: 220, filename: '220_b.sql', sql: '' },
    ])).toThrow(/sequence gap/);
  });

  it('applyPendingMigrations runs sequential SQL files and bumps schema_meta', () => {
    writeFileSync(join(migrationsDir, '002_add_probe.sql'), 'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);');
    writeFileSync(join(migrationsDir, '003_add_probe_meta.sql'), 'CREATE TABLE migration_probe_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    expect(applyPendingMigrations(db, { migrationsDir, targetVersion: 3 })).toBe(3);
    expect(readSchemaVersion(db)).toBe(3);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'").get())
      .toBeDefined();
    db.close();
  });

  it('rolls back a failed migration and leaves schema version unchanged', () => {
    writeFileSync(join(migrationsDir, '002_bad.sql'), `CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);
      INSERT INTO migration_probe VALUES (1);
      INSERT INTO nonexistent_table VALUES (1);`);

    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 2 }))
      .toThrow(/migration to v2.*failed/i);
    expect(readSchemaVersion(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_probe'").get())
      .toBeUndefined();
    db.close();
  });

  it('throws when database schema is newer than the app supports', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 99);
    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 1 }))
      .toThrow(DatabaseSchemaTooNewError);
    db.close();
  });

  it('rejects databases older than the retained release window', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, XOPC_DB_BASELINE_SCHEMA_VERSION - 1);
    expect(() => applyPendingMigrations(db)).toThrow(DatabaseSchemaTooOldError);
    db.close();
  });

  it('throws when a required migration file is missing', () => {
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    expect(() => applyPendingMigrations(db, { migrationsDir, targetVersion: 2 }))
      .toThrow(DatabaseSchemaMigrationGapError);
    db.close();
  });

  it('inspectSchemaMigrationStatus reports pending versions without mutating', () => {
    writeFileSync(join(migrationsDir, '002_add_probe.sql'), 'CREATE TABLE migration_probe (id INTEGER PRIMARY KEY);');
    const db = openEmptyDb();
    ensureSchemaMetaTable(db);
    setSchemaVersion(db, 1);
    const status = inspectSchemaMigrationStatus(db, { migrationsDir, targetVersion: 2 });
    expect(status.pendingVersions).toEqual([2]);
    expect(status.hasMigrationGap).toBe(false);
    expect(readSchemaVersion(db)).toBe(1);
    db.close();
  });
});
