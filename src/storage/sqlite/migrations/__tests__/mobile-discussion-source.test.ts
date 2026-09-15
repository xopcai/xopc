import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

it('extends the source constraint without deleting existing captures or cascading children', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE discussion_captures(id TEXT PRIMARY KEY, source TEXT NOT NULL CHECK(source IN ('web','electron')));
      CREATE TABLE chunks(capture_id TEXT REFERENCES discussion_captures(id) ON DELETE CASCADE, sequence INTEGER);
      INSERT INTO discussion_captures VALUES ('first','electron');
      INSERT INTO chunks VALUES ('first',0);`);
    db.exec(readFileSync(new URL('../173_mobile_discussion_source.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT source FROM discussion_captures').get()?.source).toBe('electron');
    expect(db.prepare('SELECT count(*) AS count FROM chunks').get()?.count).toBe(1);
    db.exec("INSERT INTO discussion_captures VALUES ('second','mobile')");
    expect(() => db.exec("INSERT INTO discussion_captures VALUES ('third','unknown')")).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
