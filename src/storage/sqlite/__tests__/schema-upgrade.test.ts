import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { memorySearchText } from '../../../knowledge-memory/search-text.js';
import { closeXopcDatabase, openXopcDatabase } from '../connection.js';
import { ensureXopcDatabaseSchema, readSchemaVersion, setSchemaVersion } from '../schema.js';
import { readSqliteAsset, resolveSqliteAssetPath } from '../sql-assets.js';

const historicalSchema = readFileSync(new URL('./fixtures/schema-v202.sql', import.meta.url), 'utf8');
const cleanSchema = readFileSync(new URL('./fixtures/schema-v217.sql', import.meta.url), 'utf8');
const files = readdirSync(resolveSqliteAssetPath('upgrades')).sort();
const directories: string[] = [];
afterEach(() => {
  closeXopcDatabase();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function historicalDatabase(version: number, path = ':memory:', clean = false): DatabaseSync {
  const db = new DatabaseSync(path);
  db.function('xopc_memory_search_text', { deterministic: true }, value => memorySearchText(String(value ?? '')));
  db.function('xopc_operation_id', () => null);
  db.exec(clean ? cleanSchema : historicalSchema);
  db.exec(`
    INSERT INTO sessions(conversation_id, agent_id, active_transcript_id, created_at, updated_at, last_accessed_at)
      VALUES ('conversation-1', 'main', 'transcript-1', 1, 2, 3);
    UPDATE sessions SET thinking_level = 'high';
    INSERT INTO transcripts(transcript_id, conversation_id, created_at, cwd) VALUES ('transcript-1', 'conversation-1', 1, '/workspace');
    INSERT INTO transcript_entries(entry_id, transcript_id, seq, entry_kind, role, payload_json, created_at)
      VALUES ('entry-1', 'transcript-1', 1, 'message', 'user', '{"text":"keep my history"}', 1);
    INSERT INTO notes(note_id, title, kind, status, payload_json, created_at, updated_at)
      VALUES ('note-1', 'Keep my note', 'text', 'active', '{}', 1, 2);
    INSERT INTO tasks(task_id, title, phase, priority, source, created_at, updated_at)
      VALUES ('task-1', 'Keep my task', 'ready', 'normal', 'user', 1, 2);
    INSERT INTO knowledge_items(knowledge_id, principal_id, kind, scope_type, content, canonical_key, status, confidence, importance, origin_class, created_at, updated_at)
      VALUES ('memory-1', 'owner', 'note', 'global', '保留我的记忆', 'memory-1', 'active', 1, 1, 'owner', 1, 2);
    INSERT INTO automations(automation_id, name, enabled, trigger_json, action_json, created_at_ms, updated_at_ms)
      VALUES ('automation-1', 'Keep my automation', 1, '{"type":"cron","cron":"0 9 * * *"}', '{"type":"agent","message":"Hello"}', 1, 2);
    INSERT INTO connector_accounts(id, connector_id, principal_id, identity_json, created_at, updated_at)
      VALUES ('account-1', 'mail', 'owner', '{"email":"test@example.com"}', '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z');
  `);
  if (clean) db.exec(`UPDATE automations SET delivery_json = '{"notificationPolicy":"attention"}'`);
  for (const file of files) {
    const target = Number(file.slice(0, 3));
    if (target > (clean ? 217 : 202) && target <= version) db.exec(readSqliteAsset(`upgrades/${file}`));
  }
  if (version >= 205) db.exec(`INSERT INTO agents(id, enabled, profile_json, overrides_json, provisioning_state, revision, created_at, updated_at)
    VALUES ('main', 1, '{"name":"My agent"}', '{"model":"provider/model"}', 'ready', 1, 1, 2)`);
  setSchemaVersion(db, version);
  return db;
}

function expectPreserved(db: DatabaseSync): void {
  expect(readSchemaVersion(db)).toBe(259);
  expect(db.prepare('SELECT conversation_id, active_transcript_id FROM sessions').all()).toEqual([{ conversation_id: 'conversation-1', active_transcript_id: 'transcript-1' }]);
  expect(db.prepare('SELECT payload_json FROM transcript_entries').get()?.payload_json).toBe('{"text":"keep my history"}');
  expect(db.prepare('SELECT title FROM notes').get()?.title).toBe('Keep my note');
  expect(db.prepare('SELECT title FROM tasks').get()?.title).toBe('Keep my task');
  expect(db.prepare('SELECT content FROM knowledge_items').get()?.content).toBe('保留我的记忆');
  expect(db.prepare('SELECT thinking_level FROM session_config').get()?.thinking_level).toBe('high');
  expect(db.prepare('SELECT name FROM automations').get()?.name).toBe('Keep my automation');
  expect(db.prepare('SELECT identity_json FROM connector_accounts').get()?.identity_json).toBe('{"email":"test@example.com"}');
  expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

describe('supported installed database upgrades', () => {
  it.each(Array.from({ length: 57 }, (_, index) => 202 + index))('preserves data upgrading historical schema v%i to v259', version => {
    const db = historicalDatabase(version);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      ensureXopcDatabaseSchema(db);
      expectPreserved(db);
      if (version >= 205) expect(db.prepare("SELECT overrides_json FROM agents WHERE id = 'main'").get()?.overrides_json).toBe('{"model":"provider/model"}');
      expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
      ensureXopcDatabaseSchema(db);
      expectPreserved(db);
    } finally { db.close(); }
  });

  it.each([217, 257, 258])('also upgrades the consolidated v217 schema at v%i', version => {
    const db = historicalDatabase(version, ':memory:', true);
    try {
      ensureXopcDatabaseSchema(db);
      expectPreserved(db);
      const fresh = new DatabaseSync(':memory:');
      try {
        ensureXopcDatabaseSchema(fresh);
        for (const { name } of fresh.prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]) {
          const columns = fresh.prepare(`SELECT name FROM pragma_table_info(?)`).all(name).map(row => row.name);
          const upgraded = db.prepare('SELECT name FROM pragma_table_info(?)').all(name).map(row => row.name);
          expect(upgraded, name).toEqual(expect.arrayContaining(columns));
        }
      } finally { fresh.close(); }
    } finally { db.close(); }
  });

  it('backs up committed WAL data before upgrading through the real connection path, and reopens without another backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-upgrade-')); directories.push(dir);
    const path = join(dir, 'xopc.db');
    const legacy = historicalDatabase(257, path, true);
    legacy.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
    legacy.exec("UPDATE notes SET title = 'WAL note' WHERE note_id = 'note-1'");
    // Keep a same-process connection alive so committed data remains in the WAL.
    const opened = openXopcDatabase({ path });
    expect(opened.db.prepare('SELECT title FROM notes').get()?.title).toBe('WAL note');
    const backups = readdirSync(dir).filter(name => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    const backup = new DatabaseSync(join(dir, backups[0]), { readOnly: true });
    try {
      expect(readSchemaVersion(backup)).toBe(257);
      expect(backup.prepare('SELECT title FROM notes').get()?.title).toBe('WAL note');
      expect(backup.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    } finally { backup.close(); legacy.close(); }
    closeXopcDatabase();
    openXopcDatabase({ path });
    expect(readdirSync(dir).filter(name => name.endsWith('.bak'))).toEqual(backups);
  });

  it('rolls back the entire chain and version when a later migration fails, then supports retry', () => {
    const db = historicalDatabase(257, ':memory:', true);
    try {
      db.exec('PRAGMA foreign_keys = ON; CREATE TABLE task_phase_changes(sentinel TEXT);');
      expect(() => ensureXopcDatabaseSchema(db)).toThrow('rolled back');
      expect(readSchemaVersion(db)).toBe(257);
      expect(db.prepare("SELECT name FROM pragma_table_info('tasks') WHERE name = 'manual_phase_revision'").get()).toBeUndefined();
      expect(db.prepare('SELECT title FROM notes').get()?.title).toBe('Keep my note');
      expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
      db.exec('DROP TABLE task_phase_changes');
      ensureXopcDatabaseSchema(db);
      expectPreserved(db);
    } finally { db.close(); }
  });

  it('rejects newer databases without changing their version', () => {
    const db = new DatabaseSync(':memory:');
    try {
      ensureXopcDatabaseSchema(db);
      setSchemaVersion(db, 260);
      expect(() => ensureXopcDatabaseSchema(db)).toThrow('newer than');
      expect(readSchemaVersion(db)).toBe(260);
    } finally { db.close(); }
  });

  it('rejects a missing packaged migration before changing data or creating a backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-upgrade-assets-')); directories.push(dir);
    const db = historicalDatabase(257, join(dir, 'xopc.db'), true);
    const originalRoot = process.env.XOPC_SQLITE_ASSET_ROOT;
    try {
      process.env.XOPC_SQLITE_ASSET_ROOT = dir;
      expect(() => ensureXopcDatabaseSchema(db)).toThrow('requires migration to v258');
      expect(readSchemaVersion(db)).toBe(257);
      expect(db.prepare('SELECT title FROM notes').get()?.title).toBe('Keep my note');
      expect(readdirSync(dir).filter(name => name.endsWith('.bak'))).toEqual([]);
    } finally {
      if (originalRoot === undefined) delete process.env.XOPC_SQLITE_ASSET_ROOT;
      else process.env.XOPC_SQLITE_ASSET_ROOT = originalRoot;
      db.close();
    }
  });
});
