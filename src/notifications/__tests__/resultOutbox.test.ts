import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installNotificationLedgerSchema } from '../../storage/sqlite/migrations/scenes/schema.js';
import { NotificationResultOutbox } from '../resultOutbox.js';
import { NotificationDispatcher } from '../dispatch.js';

describe('transactional result publication', () => {
  let directory: string;
  let db: DatabaseSync;
  let now: number;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-result-outbox-'));
    db = new DatabaseSync(join(directory, 'xopc.db'));
    db.exec('CREATE TABLE notification_events(event_id TEXT PRIMARY KEY)');
    installNotificationLedgerSchema(db);
    now = 1000;
    db.exec(`INSERT INTO notification_result_outbox
      (id, owner_id, workspace_id, subject_id, status, attempt, next_attempt_at, created_at, updated_at)
      VALUES ('result', 'owner', 'workspace', 'presentation', 'pending', 0, 1000, 1000, 1000)`);
  });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const row = () => db.prepare('SELECT * FROM notification_result_outbox').get();

  it('commits publication and acknowledgement together, without replay after restart', () => {
    const publish = vi.fn(() => { db.exec("INSERT INTO notification_events VALUES ('notification')"); return { action: 'settle' as const }; });
    expect(new NotificationResultOutbox(db, publish, () => now).drainOne()).toBe(true);
    expect(publish).toHaveBeenCalledWith({ id: 'result', ownerId: 'owner', workspaceId: 'workspace', subjectId: 'presentation' });
    expect(row()).toMatchObject({ status: 'settled', settled_at: now, lease_until: null });
    db.close(); db = new DatabaseSync(join(directory, 'xopc.db'));
    expect(new NotificationResultOutbox(db, publish, () => now).drainOne()).toBe(false);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('recovers after publication commit and delivers through the canonical dispatcher once', async () => {
    new NotificationResultOutbox(db, (result) => {
      db.exec("INSERT INTO notification_events VALUES ('notification')");
      db.prepare(`INSERT INTO notification_dispatches
        (id, notification_id, owner_id, workspace_id, channel, destination_id, subject_id, subject_revision, status, attempt, next_attempt_at)
        VALUES ('dispatch', 'notification', ?, ?, 'browser', 'subscription', ?, 1, 'pending', 0, ?)`)
        .run(result.ownerId, result.workspaceId, result.subjectId, now);
      return { action: 'settle' };
    }, () => now).drainOne();
    db.close(); db = new DatabaseSync(join(directory, 'xopc.db'));
    const send = vi.fn(async () => ({ status: 'accepted' as const, providerMessageId: null }));
    const dispatcher = new NotificationDispatcher(db, { authorize: async () => ({ action: 'send' }), send, clock: () => now });
    expect(await dispatcher.drainOne()).toBe(true);
    expect(await dispatcher.drainOne()).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    expect(row()?.status).toBe('settled');
    expect(db.prepare('SELECT status FROM notification_dispatches').get()?.status).toBe('accepted');
  });

  it('rolls back notification rows and budgets before recording a bounded retry', () => {
    const publish = vi.fn(() => {
      db.exec("INSERT INTO notification_events VALUES ('notification')");
      db.exec("INSERT INTO notification_attention_budget VALUES ('key', 'owner', 'workspace', '2026-09-20', 1000)");
      throw new Error('Private failure detail');
    });
    const outbox = new NotificationResultOutbox(db, publish, () => now);
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(outbox.drainOne()).toBe(true);
      expect(row()).toMatchObject({ status: attempt === 5 ? 'failed' : 'pending', attempt, last_error: 'publication_failed' });
      expect(db.prepare('SELECT * FROM notification_events').all()).toEqual([]);
      expect(db.prepare('SELECT * FROM notification_attention_budget').all()).toEqual([]);
      expect(outbox.drainOne()).toBe(false);
      now += 30_000;
    }
    expect(outbox.drainOne()).toBe(false);
    expect(JSON.stringify(row())).not.toContain('Private');
  });

  it('defers quiet hours without spending retry attempts', () => {
    const publish = vi.fn(() => ({ action: 'defer' as const, until: now + 60_000 }));
    const outbox = new NotificationResultOutbox(db, publish, () => now);
    expect(outbox.drainOne()).toBe(true);
    expect(row()).toMatchObject({ status: 'pending', attempt: 0, next_attempt_at: 61000, settled_at: null });
    expect(outbox.drainOne()).toBe(false);
    now += 60_000;
    expect(outbox.drainOne()).toBe(true);
    expect(row()?.attempt).toBe(0);
  });

  it('recovers only expired database-only processing leases', () => {
    db.exec("UPDATE notification_result_outbox SET status = 'processing', lease_until = 2000");
    const publish = vi.fn(() => ({ action: 'settle' as const }));
    const outbox = new NotificationResultOutbox(db, publish, () => now);
    expect(outbox.drainOne()).toBe(false);
    now = 2000;
    expect(outbox.drainOne()).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('joins an enclosing transaction so a later failure leaves the result pending', () => {
    db.exec('BEGIN');
    const outbox = new NotificationResultOutbox(db, () => {
      db.exec("INSERT INTO notification_events VALUES ('notification')");
      return { action: 'settle' };
    }, () => now);
    outbox.drainOne(); db.exec('ROLLBACK');
    expect(row()?.status).toBe('pending');
    expect(db.prepare('SELECT * FROM notification_events').all()).toEqual([]);
  });

  it('rolls back an interrupted process before replaying database-only publication', () => {
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      import { NotificationResultOutbox } from ${JSON.stringify(new URL('../resultOutbox.ts', import.meta.url).href)};
      const db = new DatabaseSync(process.argv[1]);
      new NotificationResultOutbox(db, () => {
        db.exec("INSERT INTO notification_events VALUES ('notification')");
        process.exit(42);
      }, () => 1000).drainOne();
    `, join(directory, 'xopc.db')], { timeout: 10_000, encoding: 'utf8' });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(42);
    expect(row()).toMatchObject({ status: 'pending', attempt: 0 });
    expect(db.prepare('SELECT * FROM notification_events').all()).toEqual([]);
    new NotificationResultOutbox(db, () => {
      db.exec("INSERT INTO notification_events VALUES ('notification')");
      return { action: 'settle' };
    }, () => now).drainOne();
    expect(row()?.status).toBe('settled');
    expect(db.prepare('SELECT count(*) AS n FROM notification_events').get()?.n).toBe(1);
  });

  it.each([1000, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid deferral %s', (until) => {
    new NotificationResultOutbox(db, () => ({ action: 'defer', until }), () => now).drainOne();
    expect(row()).toMatchObject({ status: 'pending', attempt: 1, last_error: 'publication_failed' });
  });
});
