import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { expect, it } from 'vitest';

it('preserves delivery decisions and foreign keys while adding a terminal failure state', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE sessions(conversation_id TEXT PRIMARY KEY);
      CREATE TABLE task_collaboration_entries(entry_id TEXT PRIMARY KEY);
      INSERT INTO sessions VALUES ('owner');
      INSERT INTO task_collaboration_entries VALUES ('pending'), ('delivered');`);
    for (const file of ['226_task_main_updates.sql', '227_task_main_update_decisions.sql']) {
      db.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    }
    db.exec(`INSERT INTO task_main_update_deliveries VALUES
      ('pending', 'owner', 'pending', 100, 'notify', 'Needs attention', 90),
      ('delivered', 'owner', 'delivered', 200, 'silent', 'Superseded', 190);`);
    db.exec(readFileSync(new URL('../256_task_main_update_retries.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT status, decision, decision_reason, decided_at, updated_at, failure_count FROM task_main_update_deliveries WHERE entry_id = ?')
      .get('pending')).toEqual({ status: 'pending', decision: 'notify', decision_reason: 'Needs attention', decided_at: 90, updated_at: 100, failure_count: 0 });
    expect(db.prepare('SELECT status FROM task_main_update_deliveries WHERE entry_id = ?').get('delivered')?.status).toBe('delivered');
    db.exec("UPDATE task_main_update_deliveries SET status = 'failed' WHERE entry_id = 'pending'");
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec("DELETE FROM sessions WHERE conversation_id = 'owner'");
    expect(db.prepare('SELECT count(*) AS count FROM task_main_update_deliveries').get()?.count).toBe(0);
  } finally {
    db.close();
  }
});
