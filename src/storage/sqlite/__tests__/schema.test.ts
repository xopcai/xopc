import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureXopcDatabaseSchema, readSchemaVersion, setSchemaVersion, ensureSchemaMetaTable, XOPC_DB_SCHEMA_VERSION, XOPC_DB_MINIMUM_SCHEMA_VERSION } from '../schema.js';

describe('SQLite schema initialization and supported upgrade boundary', () => {
  it('initializes the complete current schema without historical upgrade steps', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      ensureXopcDatabaseSchema(db);
      expect(readSchemaVersion(db)).toBe(XOPC_DB_SCHEMA_VERSION);
      expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%legacy%' OR name = 'application_migrations' OR sql LIKE '%workflow%'").all()).toEqual([]);
    } finally { db.close(); }
  });
  it('rejects older versions without modifying their schema or version', () => {
    const db = new DatabaseSync(':memory:');
    try {
      ensureSchemaMetaTable(db); setSchemaVersion(db, XOPC_DB_MINIMUM_SCHEMA_VERSION - 1);
      expect(() => ensureXopcDatabaseSchema(db)).toThrow('older than');
      expect(readSchemaVersion(db)).toBe(XOPC_DB_MINIMUM_SCHEMA_VERSION - 1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toHaveLength(1);
    } finally { db.close(); }
  });
  it('does not alter an unversioned nonempty database', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE sentinel(value TEXT)');
      expect(() => ensureXopcDatabaseSchema(db)).toThrow('unversioned');
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([{ name: 'sentinel' }]);
    } finally { db.close(); }
  });
});
