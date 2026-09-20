import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserNotificationTransport } from '../browserTransport.js';
import { NotificationDispatcher, type NotificationDispatch } from '../dispatch.js';
import { installNotificationLedgerSchema } from '../../storage/sqlite/migrations/scenes/schema.js';

describe('canonical browser notification transport', () => {
  let db: DatabaseSync;
  const dispatch: NotificationDispatch = { id: 'dispatch', notificationId: 'notification', ownerId: 'owner', workspaceId: 'workspace',
    channel: 'browser', destinationId: 'browser', destination: null, subjectId: 'subject', subjectRevision: 1, attempt: 1 };
  const signal = () => new AbortController().signal;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE notification_events(event_id TEXT PRIMARY KEY)'); installNotificationLedgerSchema(db);
    db.exec("INSERT INTO notification_browser_keys VALUES (1, 'original-public', 'original-private')");
    db.prepare(`INSERT INTO notification_browser_subscriptions VALUES ('browser', 'owner', 'workspace', ?, ?, ?, NULL, 'zh', 1000)`)
      .run('https://fcm.googleapis.com/fcm/send/test', 'a'.repeat(22), 'p'.repeat(87));
  });
  afterEach(() => db.close());
  const make = (route = '/scenes/inbox') => {
    const send = vi.fn(async () => ({ statusCode: 201, headers: {}, body: '' }));
    return { send, transport: createBrowserNotificationTransport(db, { route: () => route, send, clock: () => 1000 }) };
  };

  it('uses the preserved VAPID identity and sends only a generic lock-screen payload', async () => {
    const { transport, send } = make();
    expect(await transport(dispatch, signal())).toEqual({ status: 'accepted', providerMessageId: null });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ keys: { auth: 'a'.repeat(22), p256dh: 'p'.repeat(87) } }),
      JSON.stringify({ id: 'notification', title: '有新成果需要查看', body: '打开 xopc 查看详情。', route: '/scenes/inbox' }),
      expect.objectContaining({ vapidDetails: { subject: 'https://xopc.ai', publicKey: 'original-public', privateKey: 'original-private' } }));
  });

  it.each([{ ownerId: 'other' }, { workspaceId: 'other' }, { destinationId: 'missing' }])('refuses an unowned or missing subscription: %j', async (override) => {
    const { transport, send } = make(); expect(await transport({ ...dispatch, ...override }, signal())).toEqual({ status: 'rejected' });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['https://example.com', '//example.com', '/\\example.com', '/scenes/inbox\n', 'javascript:alert(1)'])('rejects unsafe push routes: %s', async (route) => {
    const { transport, send } = make(route); expect(await transport(dispatch, signal())).toEqual({ status: 'rejected' }); expect(send).not.toHaveBeenCalled();
  });

  it('does not send expired subscriptions or cancelled work', async () => {
    const { transport, send } = make();
    db.exec('UPDATE notification_browser_subscriptions SET expires_at = 1000');
    expect(await transport(dispatch, signal())).toEqual({ status: 'rejected' });
    db.exec('UPDATE notification_browser_subscriptions SET expires_at = NULL');
    const controller = new AbortController(); controller.abort();
    expect(await transport(dispatch, controller.signal)).toEqual({ status: 'rejected' }); expect(send).not.toHaveBeenCalled();
  });

  it('retries explicit throttling but leaves network failures unconfirmed', async () => {
    const { transport, send } = make();
    send.mockRejectedValueOnce({ statusCode: 429 });
    expect(await transport(dispatch, signal())).toEqual({ status: 'rejected', retryAt: 31000 });
    send.mockRejectedValueOnce(new Error('private transport detail'));
    await expect(transport(dispatch, signal())).rejects.toThrow('Browser transport result is unconfirmed');
    send.mockRejectedValueOnce({ statusCode: 410 });
    expect(await transport(dispatch, signal())).toEqual({ status: 'rejected' });
  });

  it('delivers through the durable dispatcher and does not resend after reconstruction', async () => {
    const { transport, send } = make();
    db.exec("INSERT INTO notification_events VALUES ('notification')");
    db.exec(`INSERT INTO notification_dispatches(id, notification_id, owner_id, workspace_id, channel, destination_id,
      subject_revision, status, attempt, next_attempt_at) VALUES ('dispatch', 'notification', 'owner', 'workspace', 'browser', 'browser', 1, 'pending', 0, 1000)`);
    const dependencies = { authorize: async () => ({ action: 'send' } as const), send: transport, clock: () => 1000 };
    const worker = new NotificationDispatcher(db, dependencies);
    await worker.drainOne(); await worker.stop();
    expect(db.prepare('SELECT status FROM notification_dispatches').get()?.status).toBe('accepted');
    expect(await new NotificationDispatcher(db, dependencies).drainOne()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
