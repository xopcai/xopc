import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { createAutomationTool } from '../../agent/tools/automation-tool.js';
import { saveAutomationRun } from '../../automations/storage/index.js';
import { AutomationService } from '../../automations/service/automation-service.js';
import { computeNextScheduleRunAtMs, timerDelayUntil } from '../../automations/domain/schedule.js';
import { getAutomationSetup, buildAutomationSetupContext } from '../../automations/configuration-conversation.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { NotificationService } from '../../notifications/service.js';
import { listNotificationEvents } from '../../notifications/store.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';
import { deliverAutomationCompletion } from '../automation-completion-delivery.js';

async function until<T>(read: () => Promise<T> | T, accepts: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Expected durable state did not arrive');
}

describe('automation reliability through authenticated lazy HTTP and persisted scheduling', () => {
  let directory: string;
  let service: AutomationService;
  let notifications: NotificationService;
  let server: ReturnType<typeof serve>;
  let base: string;
  let persistenceUnavailable: boolean;
  let brokerUnavailable: boolean;
  let executions: string[];
  const headers = { authorization: 'Bearer reliability-test', 'content-type': 'application/json' };
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
    return data;
  };
  const attach = () => {
    service.setDeps({
      getDefaultAgentId: () => 'main',
      agentService: { turnDispatcher: { processDirect: async message => {
        executions.push(message);
        if (message.includes('FAIL_FIXTURE')) throw new Error('Configured source is unavailable. Repair the task content.');
        return 'Recovered result';
      } } },
      onRunCompleted: (run, context) => {
        if (persistenceUnavailable) throw new Error('Notification database temporarily unavailable');
        deliverAutomationCompletion(run, context, notifications, () => {
          if (brokerUnavailable) throw new Error('Realtime connection temporarily unavailable');
        });
      },
    });
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-reliability-http-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    seedTestAgentCatalog();
    executions = []; persistenceUnavailable = false; brokerUnavailable = false;
    notifications = new NotificationService({ publish: () => undefined });
    service = new AutomationService(); attach(); await service.initialize();
    const app = createHonoApp({ service: {
      currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token: 'reliability-test' } } }),
      getResolvedAuth: () => ({ mode: 'token', token: 'reliability-test' }), getAuthToken: () => 'reliability-test',
      isGatewayReady: () => true, getExtensionLoader: () => null, emit: vi.fn(),
      get automationServiceInstance() { return service; },
    } as unknown as GatewayService });
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    base = `http://127.0.0.1:${address.port}/api`;
  });
  afterEach(async () => {
    await service.stop(); notifications.stop();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  it('pages history through authenticated lazy routes and aggregates unread runs beyond the latest 50', async () => {
    const task = await service.create({ name: 'History fixture', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Report' } });
    for (let i = 0; i < 55; i++) saveAutomationRun({
      id: `history-${String(i).padStart(3, '0')}`, automationId: task.id, automationName: task.name,
      status: 'succeeded', manual: false, createdAtMs: 1000, endedAtMs: 2000,
      triggerSnapshot: task.trigger, actionSnapshot: task.action, conversationId: i < 2 ? 'shared-history-conversation' : undefined,
    });
    const unauthenticated = await fetch(`${base}/automation-runs?automationId=${task.id}`);
    expect(unauthenticated.status).toBe(401);
    const first = await request(`/automation-runs?automationId=${task.id}&limit=20`);
    expect(first.runs.map((run: { id: string }) => run.id)).toEqual(Array.from({ length: 20 }, (_, i) => `history-${String(54 - i).padStart(3, '0')}`));
    expect(first.hasMore).toBe(true);
    // New executions inserted between pages must not displace or duplicate older rows.
    saveAutomationRun({ id: 'history-new', automationId: task.id, automationName: task.name, status: 'running', manual: false,
      createdAtMs: 3000, triggerSnapshot: task.trigger, actionSnapshot: task.action });
    const second = await request(`/automation-runs?automationId=${task.id}&limit=20&cursor=${encodeURIComponent(first.nextCursor)}`);
    const third = await request(`/automation-runs?automationId=${task.id}&limit=20&cursor=${encodeURIComponent(second.nextCursor)}`);
    const ids = [...first.runs, ...second.runs, ...third.runs].map(run => run.id);
    expect(new Set(ids).size).toBe(55);
    expect(ids.at(-1)).toBe('history-000');
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeUndefined();
    expect((await request('/automations')).executionSummaries[task.id].unreadCount).toBe(55);
    await request('/automation-runs/history-000/read', 'POST');
    expect((await request('/automations')).executionSummaries[task.id].unreadCount).toBe(54);
    expect((await request('/automation-runs/history-000')).run.conversationShared).toBe(true);
    expect((await request('/automation-runs/history-054')).run.conversationShared).toBe(false);
    const other = await service.create({ name: 'Other fixture', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Other' } });
    await expect(request(`/automation-runs?automationId=${other.id}&cursor=${encodeURIComponent(first.nextCursor)}`)).rejects.toThrow('400');
    await expect(request('/automation-runs?cursor=invalid')).rejects.toThrow('400');
  });

  it('repairs a failed run in its configuration chat and retries with current settings without enabling the schedule', async () => {
    const { conversationId } = await request('/automations/configuration-conversations', 'POST', {});
    const tool = createAutomationTool({ getAutomationService: () => service, getCurrentConversationId: () => conversationId });
    const created = await tool.execute('create', { action: 'create', automation: {
      name: 'Repair fixture', enabled: false,
      trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'America/New_York' } },
      action: { kind: 'agent', instruction: 'FAIL_FIXTURE' },
      delivery: { notificationPolicy: 'all', destinations: [{ key: 'gateway', kind: 'gateway_event' }] },
    } });
    const id = (created.details.automation as { id: string }).id;
    const { run } = await request(`/automations/${id}/run`, 'POST');
    await until(() => service.getRun(run.id), value => value?.status === 'failed');
    expect(buildAutomationSetupContext(conversationId)).toContain(run.id);
    expect(buildAutomationSetupContext(conversationId)).toContain('Configured source is unavailable');
    expect(await request('/automations/configuration-conversations', 'POST', { automationId: id, runId: run.id })).toEqual({ conversationId });
    expect(getAutomationSetup(conversationId)?.focusedRunId).toBe(run.id);
    expect(buildAutomationSetupContext(conversationId)).toContain('The user opened repair for this specific run');
    await expect(request('/automations/configuration-conversations', 'POST', { automationId: id, runId: 'missing' })).rejects.toThrow('404');
    await request('/automations/configuration-conversations', 'POST', { automationId: id });
    expect(getAutomationSetup(conversationId)?.focusedRunId).toBeUndefined();
    const { automation } = await request(`/automations/${id}`);
    await tool.execute('repair', { action: 'update', automationId: id, expectedRevision: automation.updatedAtMs,
      patch: { action: { kind: 'agent', instruction: 'RECOVERED_FIXTURE' } } });
    const rerun = await tool.execute('retry', { action: 'rerun', runId: run.id, idempotencyKey: 'repair-retry-once' });
    const retryId = (rerun.details.run as { id: string }).id;
    await until(() => service.getRun(retryId), value => value?.status === 'succeeded');
    await tool.execute('retry-again', { action: 'rerun', runId: run.id, idempotencyKey: 'repair-retry-once' });
    expect((await request(`/automations/${id}`)).automation.enabled).toBe(false);
    expect(getAutomationSetup(conversationId)).toEqual({ automationId: id });
    expect(executions).toHaveLength(2);
    await until(() => listNotificationEvents({ since: 0 }).items, items => items.length === 2);
    expect(listNotificationEvents({ since: 0 }).items.map(item => item.type).sort()).toEqual(['automation.completed', 'automation.failed']);
  });

  it('recovers notification handoff after a database reopen without rerunning work or duplicating inbox events', async () => {
    persistenceUnavailable = true;
    const { automation } = await request('/automations', 'POST', { name: 'Durable notification', trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'NOTIFICATION_FIXTURE' },
      delivery: { notificationPolicy: 'all', destinations: [{ key: 'gateway', kind: 'gateway_event' }] } });
    const { run } = await request(`/automations/${automation.id}/run`, 'POST');
    await until(() => service.listResultDeliveries({ runId: run.id }), items => items[0]?.status === 'retrying');
    expect(listNotificationEvents({ since: 0 }).items).toHaveLength(0);
    await service.stop();
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
    persistenceUnavailable = false; brokerUnavailable = true;
    getSqliteDatabase().prepare('UPDATE automation_result_deliveries SET next_attempt_at_ms = 0').run();
    service = new AutomationService(); attach(); await service.initialize();
    await until(() => service.listResultDeliveries({ runId: run.id }), items => items[0]?.attempts === 2 && items[0]?.status === 'retrying');
    expect(listNotificationEvents({ since: 0 }).items).toHaveLength(1);
    getSqliteDatabase().prepare('UPDATE automation_result_deliveries SET attempts = 4, next_attempt_at_ms = 0').run();
    service.dispatchRecoveryWork();
    await until(() => service.listResultDeliveries({ runId: run.id }), items => items[0]?.status === 'dead_letter');
    brokerUnavailable = false;
    const tool = createAutomationTool({ getAutomationService: () => service });
    await tool.execute('retry-notification', { action: 'retry_delivery', runId: run.id, destinationKey: 'gateway',
      reason: 'The connection is available again', idempotencyKey: 'resend-without-execution' });
    await until(() => service.listResultDeliveries({ runId: run.id }), items => items[0]?.status === 'delivered');
    expect(executions).toHaveLength(1);
    expect(listNotificationEvents({ since: 0 }).items).toHaveLength(1);
    const inbox = await request('/notifications?since=0');
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0].target).toMatchObject({ kind: 'automation_run', automationId: automation.id, runId: run.id });
    const ack = await request(`/notifications/${inbox.items[0].id}/ack`, 'POST', { consumerId: 'e2e-browser', surface: 'web' });
    expect(ack.ok).toBe(true);
  });

  it('coalesces a missed one-time run on restart exactly once and preserves fixed-interval cadence', async () => {
    await service.stop();
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse('2026-10-25T00:00:00Z'); vi.setSystemTime(start);
    const { automation } = await request('/automations', 'POST', { name: 'Offline one-time task',
      trigger: { kind: 'schedule', schedule: { kind: 'once', at: new Date(start + 60_000).toISOString() } },
      action: { kind: 'agent', instruction: 'MISSED_ONCE' } });
    const interval = await service.create({ name: 'Stable interval', trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: 60_000 } },
      action: { kind: 'agent', instruction: 'INTERVAL' }, enabled: false });
    expect(interval.trigger).toMatchObject({ schedule: { anchorMs: start } });
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') });
    vi.setSystemTime(start + 3 * 60_000 + 15_000);
    service = new AutomationService(); attach(); await service.initialize();
    await until(() => service.listRuns({ automationId: automation.id }), items => items[0]?.status === 'succeeded');
    expect(executions.filter(value => value.includes('MISSED_ONCE'))).toHaveLength(1);
    await service.stop();
    service = new AutomationService(); attach(); await service.initialize();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await service.listRuns({ automationId: automation.id })).length).toBe(1);
    const resumed = await service.resume(interval.id);
    expect(resumed?.state.nextRunAtMs).toBe(start + 4 * 60_000);
  });

  it('honors quiet and attention-only policies while preserving run history', async () => {
    for (const [policy, instruction, expected] of [
      ['none', 'FAIL_FIXTURE', 0], ['attention', 'QUIET_SUCCESS', 0], ['attention', 'FAIL_FIXTURE', 1],
    ] as const) {
      const { automation } = await request('/automations', 'POST', { name: `Policy ${policy}`, trigger: { kind: 'manual' },
        action: { kind: 'agent', instruction }, delivery: { notificationPolicy: policy, destinations: [{ key: 'gateway', kind: 'gateway_event' }] } });
      const { run } = await request(`/automations/${automation.id}/run`, 'POST');
      await until(() => service.listResultDeliveries({ runId: run.id }), items => items[0]?.status === 'delivered');
      expect(listNotificationEvents({ since: 0 }).items).toHaveLength(expected);
      expect((await service.listRuns({ automationId: automation.id })).length).toBe(1);
    }
  });

  it('keeps daily New York wall-clock time across both DST transitions and supports timers longer than 24 days', () => {
    const schedule = { kind: 'cron' as const, expr: '0 9 * * *', tz: 'America/New_York' };
    expect(new Date(computeNextScheduleRunAtMs(schedule, Date.parse('2026-03-07T15:00:00Z'))!).toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(new Date(computeNextScheduleRunAtMs(schedule, Date.parse('2026-10-31T15:00:00Z'))!).toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(timerDelayUntil(90 * 86400_000, 0)).toBe(2 ** 31 - 1);
  });
});
