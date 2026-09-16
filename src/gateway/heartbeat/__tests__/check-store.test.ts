import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { updateProactivePreferences } from '../../../proactive/policy/service.js';
import { beginHeartbeatCheck, completeHeartbeatCheck, deliverHeartbeatChecks, recentHeartbeatChecks, recoverHeartbeatChecks } from '../check-store.js';

describe('durable heartbeat delivery', () => {
  let dir: string;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
    dir = mkdtempSync(join(tmpdir(), 'xopc-heartbeat-'));
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    updateProactivePreferences('workspace', { expectedRevision: 0, quietStartHour: 0, quietEndHour: 0, timezone: 'UTC' });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });
  const prepare = (text = 'Review the approaching deadline', target: string | undefined = 'weixin') => {
    const id = beginHeartbeatCheck('workspace');
    completeHeartbeatCheck(id, 'prepared', undefined, text, target, target ? 'chat' : undefined);
    return id;
  };
  it('persists dedupe across restart and reports a bus handoff as queued', async () => {
    prepare(); const bus = { publishOutbound: vi.fn().mockResolvedValue(undefined) };
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    expect(bus.publishOutbound).toHaveBeenCalledWith(expect.objectContaining({ channel: 'weixin', chat_id: 'chat' }));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    recoverHeartbeatChecks('workspace'); prepare();
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    expect(bus.publishOutbound).toHaveBeenCalledTimes(1);
    expect(recentHeartbeatChecks('workspace').map(row => row.deliveryStatus)).toEqual(['duplicate', 'queued']);
  });
  it('keeps results during mute, resumes within expiry, and shares the daily budget', async () => {
    updateProactivePreferences('workspace', { expectedRevision: 1, notificationsMuted: true, dailyNotificationLimit: 1 });
    prepare(); const bus = { publishOutbound: vi.fn().mockResolvedValue(undefined) };
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    expect(bus.publishOutbound).not.toHaveBeenCalled(); expect(recentHeartbeatChecks('workspace')[0]?.content).toContain('deadline');
    updateProactivePreferences('workspace', { expectedRevision: 2, notificationsMuted: false });
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat'); prepare('Another result');
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    expect(bus.publishOutbound).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-17T13:00:00Z'));
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    expect(recentHeartbeatChecks('workspace')[0]?.deliveryStatus).toBe('expired');
  });
  it('does not replay an ambiguous send and exposes interrupted checks', async () => {
    prepare(); const bus = { publishOutbound: vi.fn().mockRejectedValue(new Error('disconnected')) };
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    expect(bus.publishOutbound).toHaveBeenCalledTimes(1); expect(recentHeartbeatChecks('workspace')[0]?.deliveryStatus).toBe('unknown');
    beginHeartbeatCheck('workspace'); recoverHeartbeatChecks('workspace');
    expect(recentHeartbeatChecks('workspace')[0]?.status).toBe('interrupted');
  });
  it('retains a result without a destination and cancels a changed destination', async () => {
    const id = beginHeartbeatCheck('workspace'); completeHeartbeatCheck(id, 'prepared', undefined, 'Saved result');
    expect(recentHeartbeatChecks('workspace')[0]?.deliveryStatus).toBe('no_target');
    prepare(); const bus = { publishOutbound: vi.fn() };
    await deliverHeartbeatChecks('workspace', bus, 'telegram', 'other');
    expect(bus.publishOutbound).not.toHaveBeenCalled(); expect(recentHeartbeatChecks('workspace')[0]?.deliveryStatus).toBe('cancelled');
  });
  it('delays quiet hours and paused checks, and recovers an interrupted handoff without resend', async () => {
    prepare(); const bus = { publishOutbound: vi.fn() };
    updateProactivePreferences('workspace', { expectedRevision: 1, checksPaused: true });
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat'); expect(bus.publishOutbound).not.toHaveBeenCalled();
    updateProactivePreferences('workspace', { expectedRevision: 2, checksPaused: false, quietStartHour: 10, quietEndHour: 14 });
    await deliverHeartbeatChecks('workspace', bus, 'weixin', 'chat');
    expect(getSqliteDatabase().prepare('SELECT next_attempt_at FROM heartbeat_checks').get()).toMatchObject({ next_attempt_at: '2026-09-16T14:00:00.000Z' });
    getSqliteDatabase().prepare("UPDATE heartbeat_checks SET delivery_status = 'sending'").run(); recoverHeartbeatChecks('workspace');
    expect(recentHeartbeatChecks('workspace')[0]?.deliveryStatus).toBe('unknown');
  });
});
