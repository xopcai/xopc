import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeXopcDatabase, createDevice, createClarificationWait, ensureSessionRecord,
  openXopcDatabase, resetXopcDatabaseSingletonForTest, resolveClarification,
} from '../../storage/sqlite/index.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { flushClarificationNotifications } from '../clarification.js';
import { registerNotificationDevice, updateNotificationDevicePreferences } from '../device-store.js';
import { NotificationService } from '../service.js';
import { listNotificationEvents, notificationDeliveryMetrics } from '../store.js';

describe('durable clarification notifications', () => {
  let dir: string;
  const conversationId = '5f8923f9-52c1-47a6-8174-bfe092661681';
  const request = { conversationId, runId: 'run-1', toolCallId: 'tool-1', kind: 'input' as const, question: 'Private question?' };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-clarification-notification-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord(conversationId, dir, { agentId: 'main' });
    createDevice({ id: 'phone', displayName: 'Phone', platform: 'harmonyos', publicKeyJwk: { kty: 'EC' }, scopes: ['notifications.self'] });
    registerNotificationDevice({ deviceId: 'phone', platform: 'harmonyos', pushToken: 'test-token', permissions: 'granted', locale: 'en' });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('recovers an unconsumed intent after reopening, preserves age and deduplicates the same question', async () => {
    const wait = createClarificationWait({ ...request, now: Date.now() - 600_000 });
    expect(createClarificationWait(request).id).toBe(wait.id);
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    const publish = vi.fn();
    const sendHarmony = vi.fn().mockResolvedValue('accepted');
    const service = new NotificationService({ publish, sendHarmony });
    await service.drain();
    await service.drain();
    expect(publish).toHaveBeenCalledOnce();
    expect(sendHarmony).toHaveBeenCalledOnce();
    const events = listNotificationEvents({ since: 0 }).items;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'chat.needs_input', createdAt: wait.createdAt,
      payload: { waitId: wait.id, kind: 'input' }, target: { kind: 'chat', conversationId } });
    expect(JSON.stringify(events[0])).not.toContain(request.question);
  });

  it('rolls back wait and intent together, and retries an interrupted publication transaction', () => {
    expect(() => runSqliteWriteTransaction(() => {
      createClarificationWait(request);
      throw new Error('crash');
    })).toThrow('crash');
    const db = getSqliteDatabase();
    expect(db.prepare('SELECT * FROM clarification_notification_outbox').all()).toHaveLength(0);
    createClarificationWait(request);
    const service = new NotificationService({ publish: vi.fn() });
    expect(() => flushClarificationNotifications(plan => {
      service.persistPlan(plan);
      throw new Error('publication crash');
    })).toThrow('publication crash');
    expect(listNotificationEvents({ since: 0 }).items).toHaveLength(0);
    expect(db.prepare("SELECT * FROM clarification_notification_outbox WHERE status = 'pending'").all()).toHaveLength(1);
    expect(flushClarificationNotifications(plan => service.persistPlan(plan))).toHaveLength(1);
  });

  it.each(['answer', 'cancel', 'agent_decide'] as const)('cancels queued delivery after %s', async action => {
    const wait = createClarificationWait(request);
    const sendHarmony = vi.fn().mockResolvedValue('accepted');
    const service = new NotificationService({ publish: vi.fn(), sendHarmony });
    flushClarificationNotifications(plan => service.persistPlan(plan));
    expect(resolveClarification({ id: wait.id, expectedVersion: wait.version, idempotencyKey: 'respond', action, answer: 'A' }).ok).toBe(true);
    await service.drain();
    expect(sendHarmony).not.toHaveBeenCalled();
    expect(notificationDeliveryMetrics()).toMatchObject({ cancelled: 1, dead: 0 });
  });

  it('does not publish superseded waits and still notifies a new question in the same run', async () => {
    createClarificationWait(request);
    const next = createClarificationWait({ ...request, toolCallId: 'tool-2' });
    const publish = vi.fn();
    const service = new NotificationService({ publish, sendHarmony: vi.fn().mockResolvedValue('accepted') });
    await service.drain();
    expect(publish).toHaveBeenCalledOnce();
    expect(listNotificationEvents({ since: 0 }).items[0]?.payload.waitId).toBe(next.id);
  });

  it('cancels expired approvals and honors changed preferences before delivery', async () => {
    const wait = createClarificationWait({ ...request, kind: 'approval' });
    const sendHarmony = vi.fn().mockResolvedValue('accepted');
    const service = new NotificationService({ publish: vi.fn(), sendHarmony });
    flushClarificationNotifications(plan => service.persistPlan(plan));
    updateNotificationDevicePreferences('phone', { chatNeedsInput: false });
    await service.drain();
    expect(sendHarmony).not.toHaveBeenCalled();
    updateNotificationDevicePreferences('phone', { chatNeedsInput: true });
    const db = getSqliteDatabase();
    db.prepare('UPDATE session_clarification_waits SET data_json = json_set(data_json, \'$.expiresAt\', ?) WHERE id = ?').run(Date.now() - 1, wait.id);
    db.prepare("UPDATE notification_deliveries SET status = 'pending'").run();
    await service.drain();
    expect(notificationDeliveryMetrics()).toMatchObject({ cancelled: 1 });
    expect(sendHarmony).not.toHaveBeenCalled();
  });

  it('leaves TaskRun questions to the existing Task attention notification', async () => {
    const wait = createClarificationWait(request);
    getSqliteDatabase().prepare("UPDATE session_clarification_waits SET data_json = json_set(data_json, '$.taskRunId', 'task-run') WHERE id = ?").run(wait.id);
    const publish = vi.fn();
    const sendHarmony = vi.fn();
    await new NotificationService({ publish, sendHarmony }).drain();
    expect(publish).not.toHaveBeenCalled();
    expect(sendHarmony).not.toHaveBeenCalled();
    expect(getSqliteDatabase().prepare('SELECT status FROM clarification_notification_outbox').get()?.status).toBe('settled');
  });

  it('ignores questions from a transcript that is no longer current', async () => {
    const wait = createClarificationWait(request);
    getSqliteDatabase().prepare("UPDATE session_clarification_waits SET data_json = json_set(data_json, '$.transcriptId', 'old-transcript') WHERE id = ?").run(wait.id);
    const publish = vi.fn();
    await new NotificationService({ publish, sendHarmony: vi.fn() }).drain();
    expect(publish).not.toHaveBeenCalled();
  });

  it('uses the Personal destination and supplies approval expiry to push', async () => {
    getSqliteDatabase().prepare("UPDATE sessions SET custom_data_json = '{\"personalAgent\":true}' WHERE conversation_id = ?").run(conversationId);
    const wait = createClarificationWait({ ...request, kind: 'approval' });
    const sendHarmony = vi.fn().mockResolvedValue('accepted');
    await new NotificationService({ publish: vi.fn(), sendHarmony }).drain();
    expect(listNotificationEvents({ since: 0 }).items[0]?.target).toEqual({ kind: 'chat', conversationId, personal: true });
    expect(sendHarmony).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: wait.expiresAt }), expect.any(Function));
  });
});
