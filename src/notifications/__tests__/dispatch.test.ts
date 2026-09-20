import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationDispatcher, type DispatchPolicy, type DispatchReceipt } from '../dispatch.js';
import { installNotificationLedgerSchema } from '../../storage/sqlite/migrations/scenes/schema.js';

describe('durable notification dispatcher', () => {
  let db: DatabaseSync;
  let now: number;
  beforeEach(() => {
    now = 1000;
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE notification_events(event_id TEXT PRIMARY KEY)');
    installNotificationLedgerSchema(db);
    db.exec("INSERT INTO notification_events VALUES ('notification')");
    db.prepare(`INSERT INTO notification_dispatches(id, notification_id, owner_id, workspace_id, channel, destination_id,
      subject_id, subject_revision, status, attempt, next_attempt_at) VALUES ('dispatch', 'notification', 'owner', 'workspace', 'browser', 'browser', 'subject', 2, 'pending', 0, ?)`)
      .run(now);
  });
  afterEach(() => { db.close(); vi.useRealTimers(); });
  const row = () => db.prepare('SELECT * FROM notification_dispatches').get()!;
  const make = (send = vi.fn(async (): Promise<DispatchReceipt> => ({ status: 'accepted', providerMessageId: null })),
    authorize = vi.fn(async (): Promise<DispatchPolicy> => ({ action: 'send' }))) => ({
    send, authorize, dispatcher: new NotificationDispatcher(db, { send, authorize, clock: () => now, timeoutMs: 100 }),
  });

  it('checks the saved scope and records acceptance only once', async () => {
    const { dispatcher, send, authorize } = make();
    expect(await dispatcher.drainOne()).toBe(true);
    expect(authorize.mock.calls[0][0]).toMatchObject({ ownerId: 'owner', workspaceId: 'workspace', subjectId: 'subject', subjectRevision: 2 });
    expect(row()).toMatchObject({ status: 'accepted', attempt: 1, lease_until: null });
    expect(await dispatcher.drainOne()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('serializes overlapping drains and competing dispatcher instances', async () => {
    let accept!: (value: DispatchReceipt) => void;
    const send = vi.fn(() => new Promise<DispatchReceipt>((resolve) => { accept = resolve; }));
    const first = make(send); const second = make();
    const running = first.dispatcher.drainOne(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(await first.dispatcher.drainOne()).toBe(false);
    expect(await second.dispatcher.drainOne()).toBe(false);
    accept({ status: 'accepted', providerMessageId: null }); await running;
    expect(send).toHaveBeenCalledTimes(1); expect(second.send).not.toHaveBeenCalled();
  });

  it('never replays a crashed sender after lease expiry', async () => {
    db.prepare("UPDATE notification_dispatches SET status = 'sending', attempt = 1, lease_until = ?").run(now - 1);
    const { dispatcher, send } = make();
    expect(await dispatcher.drainOne()).toBe(false);
    expect(row()).toMatchObject({ status: 'unknown', last_error: 'lease_expired' }); expect(send).not.toHaveBeenCalled();
  });

  it('cancels revoked policy and defers quiet hours without sending', async () => {
    const authorize = vi.fn(async (): Promise<DispatchPolicy> => ({ action: 'defer', until: now + 1000 }));
    const { dispatcher, send } = make(undefined, authorize);
    await dispatcher.drainOne(); expect(row()).toMatchObject({ status: 'pending', next_attempt_at: 2000 });
    expect(await dispatcher.drainOne()).toBe(false);
    now = 2000; authorize.mockResolvedValue({ action: 'cancel' }); await dispatcher.drainOne();
    expect(row().status).toBe('cancelled'); expect(send).not.toHaveBeenCalled();
  });

  it('retries only a confirmed rejection and caps attempts', async () => {
    const send = vi.fn(async (): Promise<DispatchReceipt> => ({ status: 'rejected', retryAt: now + 1000 }));
    const { dispatcher } = make(send);
    for (let attempt = 1; attempt <= 5; attempt++) { await dispatcher.drainOne(); now += 1000; }
    expect(row()).toMatchObject({ status: 'failed', attempt: 5 }); expect(send).toHaveBeenCalledTimes(5);
    expect(await dispatcher.drainOne()).toBe(false);
  });

  it('keeps claim fencing monotonic without spending retry budget during quiet hours', async () => {
    const authorize = vi.fn(async (): Promise<DispatchPolicy> => ({ action: 'defer', until: now + 1000 }));
    const send = vi.fn(async (): Promise<DispatchReceipt> => ({ status: 'rejected', retryAt: now + 1000 }));
    const { dispatcher } = make(send, authorize);
    for (let deferred = 0; deferred < 8; deferred++) { await dispatcher.drainOne(); now += 1000; }
    expect(row()).toMatchObject({ status: 'pending', attempt: 8, failure_count: 0 });
    authorize.mockResolvedValue({ action: 'send' });
    for (let failed = 1; failed <= 5; failed++) { await dispatcher.drainOne(); now += 1000; }
    expect(row()).toMatchObject({ status: 'failed', attempt: 13, failure_count: 5 });
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('keeps transport exceptions unknown and excludes private errors from the ledger', async () => {
    const { dispatcher, send } = make(vi.fn(async () => { throw new Error('Secret token and message'); }));
    await dispatcher.drainOne();
    expect(row()).toMatchObject({ status: 'unknown', last_error: 'transport_unconfirmed' });
    expect(JSON.stringify(row())).not.toContain('Secret'); now += 100000;
    expect(await dispatcher.drainOne()).toBe(false); expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not accept a Telegram send without a provider receipt', async () => {
    db.exec("UPDATE notification_dispatches SET channel = 'telegram'");
    const { dispatcher } = make(); await dispatcher.drainOne();
    expect(row()).toMatchObject({ status: 'unknown', last_error: 'missing_provider_receipt' });
  });

  it('preserves the Telegram receipt', async () => {
    db.exec("UPDATE notification_dispatches SET channel = 'telegram'");
    const { dispatcher } = make(vi.fn(async () => ({ status: 'accepted', providerMessageId: 'provider-42' } as const)));
    await dispatcher.drainOne(); expect(row()).toMatchObject({ status: 'accepted', provider_message_id: 'provider-42' });
  });

  it('bounds an uncooperative sender and ignores its late acceptance', async () => {
    vi.useFakeTimers();
    let accept!: (value: DispatchReceipt) => void;
    const { dispatcher } = make(vi.fn(() => new Promise<DispatchReceipt>((resolve) => { accept = resolve; })));
    const running = dispatcher.drainOne(); await vi.advanceTimersByTimeAsync(101); await running;
    expect(row().status).toBe('unknown');
    accept({ status: 'accepted', providerMessageId: 'late' }); await Promise.resolve();
    expect(row().status).toBe('unknown');
  });

  it('stops during policy evaluation without sending and ignores a late policy result', async () => {
    let allow!: (value: DispatchPolicy) => void;
    const authorize = vi.fn(() => new Promise<DispatchPolicy>((resolve) => { allow = resolve; }));
    const { dispatcher, send } = make(undefined, authorize);
    const running = dispatcher.drainOne(); await Promise.resolve();
    await dispatcher.stop(); await running;
    expect(row()).toMatchObject({ status: 'pending', last_error: 'policy_unavailable' });
    allow({ action: 'send' }); await Promise.resolve();
    expect(send).not.toHaveBeenCalled(); expect(await dispatcher.drainOne()).toBe(false);
  });

  it('stops before a claim without touching the delivery', async () => {
    const { dispatcher, send } = make(); const running = dispatcher.drainOne(); await dispatcher.stop();
    expect(await running).toBe(false); expect(row()).toMatchObject({ status: 'pending', attempt: 0 }); expect(send).not.toHaveBeenCalled();
  });
});
