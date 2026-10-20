import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { expect, it } from 'vitest';

it('preserves existing tasks and runs while adding durable phase history and revision fences', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE tasks(task_id TEXT PRIMARY KEY, phase TEXT NOT NULL);
      CREATE TABLE task_runs(run_id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(task_id));
      INSERT INTO tasks VALUES ('task', 'active');
      INSERT INTO task_runs VALUES ('run', 'task');`);
    db.exec(readFileSync(new URL('../258_task_phase_changes.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT * FROM tasks').get()).toEqual({ task_id: 'task', phase: 'active',
      manual_phase_revision: 0, automatic_phase_revision: 0 });
    expect(db.prepare('SELECT manual_phase_revision FROM task_runs').get()?.manual_phase_revision).toBe(0);
    db.prepare(`INSERT INTO task_phase_changes VALUES
      ('change', 'task', 'active', 'closed', NULL, 'done', '{"kind":"user"}', 'board', 'operation', 'run', 2, 100)`).run();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.exec("DELETE FROM task_runs; DELETE FROM tasks;");
    expect(db.prepare('SELECT count(*) AS count FROM task_phase_changes').get()?.count).toBe(0);
  } finally {
    db.close();
  }
});
