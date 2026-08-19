import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

describe('work item lifecycle migration', () => {
  let db: DatabaseSync | undefined;

  afterEach(() => db?.close());

  it('rebuilds legacy work items without legacy columns or tables', () => {
    db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE work_items (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
        status TEXT NOT NULL, priority TEXT NOT NULL, owner_agent_id TEXT, next_action TEXT,
        blocked_reason TEXT, due_at INTEGER, completed_at INTEGER, archived_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE work_item_events (
        id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, type TEXT NOT NULL,
        payload_json TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE work_item_update_suggestions (
        id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL, status TEXT NOT NULL, patch_json TEXT NOT NULL,
        progress_note TEXT, rationale TEXT, confidence REAL, created_at INTEGER NOT NULL,
        applied_at INTEGER, dismissed_at INTEGER
      );
      CREATE TABLE proactive_scenarios (
        scenario_key TEXT PRIMARY KEY,
        event_types_json TEXT NOT NULL,
        condition_json TEXT
      );
      INSERT INTO proactive_scenarios VALUES
        ('project_delivery_risk', '["work_item.status_changed.v1"]', NULL),
        ('blocked_work', '["work_item.status_changed.v1"]', '{"op":"eq","field":"payload.after.status","value":"blocked"}');
    `);
    const insert = db.prepare(`INSERT INTO work_items
      (id, project_id, title, status, priority, next_action, blocked_reason, completed_at, created_at, updated_at)
      VALUES (?, 'p-1', ?, ?, 'normal', ?, ?, ?, 10, 20)`);
    insert.run('backlog', 'Backlog', 'backlog', null, null, null);
    insert.run('ready', 'Ready', 'todo', 'Start it', null, null);
    insert.run('blocked', 'Blocked', 'blocked', 'Retry', 'Vendor unavailable', null);
    insert.run('input', 'Needs input', 'needs_input', 'Choose region', null, null);
    insert.run('review', 'Review', 'in_review', 'Approve', null, null);
    insert.run('done', 'Done', 'done', null, null, 18);
    insert.run('cancelled', 'Cancelled', 'cancelled', null, null, null);

    const sql = readFileSync(new URL('../migrations/097_work_item_lifecycle.sql', import.meta.url), 'utf8');
    db.exec(sql);

    const columns = db.prepare(`PRAGMA table_info(work_items)`).all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'phase', 'completion_policy', 'resolution', 'closed_at', 'version',
    ]));
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      'status', 'blocked_reason', 'completed_at',
    ]));
    expect(db.prepare(`SELECT phase, resolution, closed_at FROM work_items WHERE id = 'done'`).get())
      .toEqual({ phase: 'closed', resolution: 'completed', closed_at: 18 });
    expect(db.prepare(`SELECT phase, completion_policy FROM work_items WHERE id = 'review'`).get())
      .toEqual({ phase: 'verifying', completion_policy: 'user_accepted' });
    expect(db.prepare(`SELECT kind, reason FROM work_item_waits WHERE work_item_id = 'blocked'`).get())
      .toEqual({ kind: 'external', reason: 'Vendor unavailable' });
    expect(db.prepare(`SELECT kind FROM work_item_waits WHERE work_item_id = 'input'`).get())
      .toEqual({ kind: 'user_input' });
    expect(() => db!.prepare(`SELECT * FROM work_item_update_suggestions`).all()).toThrow();
    expect(db.prepare(`SELECT event_types_json, condition_json FROM proactive_scenarios WHERE scenario_key = 'blocked_work'`).get())
      .toEqual({
        event_types_json: '["work_item.lifecycle_changed.v1","work_item.updated.v1"]',
        condition_json: '{"op":"eq","field":"payload.command","value":"wait"}',
      });
  });
});
