import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { AutomationService } from '../../service/automation-service.js';
import { saveAutomationRun } from '../../storage/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { AutomationDeliveryRouter, listAutomationResultDeliveries } from '../delivery-router.js';

describe('automation result delivery router', () => {
  let directory: string;
  let service: AutomationService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-delivery-router-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    service = new AutomationService();
  });

  afterEach(async () => {
    await service.stop();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(directory, { recursive: true, force: true });
  });

  it('claims a destination before external delivery so concurrent routers do not both send it', async () => {
    const automation = await service.create({
      name: 'Delivery claim', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'done' },
    });
    const queued = service.queueRunAtomically(automation.id);
    const completed = { ...queued, status: 'succeeded' as const, currentPhase: 'completed' as const, endedAtMs: Date.now() };
    saveAutomationRun(completed);

    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const deliverGatewayEvent = async () => { calls += 1; await blocked; };
    const first = new AutomationDeliveryRouter({ deliverGatewayEvent });
    const second = new AutomationDeliveryRouter({ deliverGatewayEvent });
    first.enqueue(completed, automation);

    const firstDispatch = first.dispatch();
    while (calls === 0) await new Promise(resolve => setTimeout(resolve, 5));
    expect(await second.dispatch()).toBe(0);
    release();
    expect(await firstDispatch).toBe(1);
    expect(calls).toBe(1);
    expect(listAutomationResultDeliveries({ runId: queued.id })).toEqual([
      expect.objectContaining({ status: 'delivered', attempts: 1 }),
    ]);
  });

  it('does not report an asynchronous gateway delivery failure as delivered', async () => {
    const automation = await service.create({
      name: 'Async gateway failure', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'done' },
    });
    const queued = service.queueRunAtomically(automation.id);
    const completed = { ...queued, status: 'succeeded' as const, currentPhase: 'completed' as const, endedAtMs: Date.now() };
    saveAutomationRun(completed);
    const router = new AutomationDeliveryRouter({ deliverGatewayEvent: async () => { throw new Error('broker unavailable'); } });
    router.enqueue(completed, automation);

    expect(await router.dispatch()).toBe(0);
    expect(listAutomationResultDeliveries({ runId: queued.id })).toEqual([
      expect.objectContaining({ status: 'retrying', attempts: 1, lastError: 'broker unavailable' }),
    ]);
  });

  it('releases an in-flight delivery without consuming an attempt during shutdown', async () => {
    const automation = await service.create({
      name: 'Graceful delivery stop', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'done' },
    });
    const queued = service.queueRunAtomically(automation.id);
    const completed = { ...queued, status: 'succeeded' as const, currentPhase: 'completed' as const, endedAtMs: Date.now() };
    saveAutomationRun(completed);
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const router = new AutomationDeliveryRouter();
    router.register('card', async ({ signal }) => {
      started();
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    router.enqueue(completed, {
      ...automation,
      delivery: { notificationPolicy: 'none', destinations: [
        { key: 'shutdown', kind: 'card', channelId: 'test', templateId: 'test' },
      ] },
    });
    const dispatch = router.dispatch();
    await ready;
    await router.stop();
    await dispatch;
    expect(listAutomationResultDeliveries({ runId: queued.id })).toEqual([
      expect.objectContaining({ status: 'retrying', attempts: 0 }),
    ]);
  });

  it('emits dead-letter attention once when a maximum-attempt lease expires', async () => {
    const automation = await service.create({
      name: 'Expired delivery lease', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'done' },
    });
    const queued = service.queueRunAtomically(automation.id);
    const completed = { ...queued, status: 'succeeded' as const, currentPhase: 'completed' as const, endedAtMs: Date.now() };
    saveAutomationRun(completed);
    const attention = vi.fn();
    const router = new AutomationDeliveryRouter({ onDeadLetter: attention });
    router.enqueue(completed, automation);
    getSqliteDatabase().prepare(`UPDATE automation_result_deliveries
      SET status = 'delivering', attempts = 5, lease_owner = 'dead-worker', lease_until_ms = 0
      WHERE run_id = ?`).run(queued.id);

    expect(await router.dispatch()).toBe(0);
    expect(await router.dispatch()).toBe(0);
    expect(attention).toHaveBeenCalledTimes(1);
    expect(attention).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'result_delivery', runId: queued.id, error: 'Delivery lease expired after maximum attempts',
    }));
  });

  it('delivers gateway events from the persisted run snapshot after the automation is deleted', async () => {
    const automation = await service.create({
      name: 'Snapshot delivery', projectId: 'project-1', trigger: { kind: 'manual' },
      action: { kind: 'agent', instruction: 'done' }, safety: { mode: 'ask_before_apply' },
      delivery: { notificationPolicy: 'all', destinations: [{ key: 'gateway', kind: 'gateway_event' }] },
    });
    const queued = service.queueRunAtomically(automation.id);
    const completed = { ...queued, status: 'succeeded' as const, currentPhase: 'completed' as const, endedAtMs: Date.now() };
    saveAutomationRun(completed);
    const delivered: unknown[] = [];
    const router = new AutomationDeliveryRouter({ deliverGatewayEvent: async (_run, context) => { delivered.push(context); } });
    router.enqueue(completed, automation);
    await service.remove(automation.id);

    expect(await router.dispatch()).toBe(1);
    expect(delivered).toEqual([{ notificationPolicy: 'all', requiresAttention: true, projectId: 'project-1' }]);
  });

  it('signs webhooks and keeps one idempotency key across attempts', async () => {
    vi.stubEnv('XOPC_AUTOMATION_WEBHOOK_SECRETS', JSON.stringify({ outbound: '0123456789abcdef' }));
    const automation = await service.create({
      name: 'Signed webhook', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'done' },
      delivery: { notificationPolicy: 'none', destinations: [
        { key: 'audit', kind: 'webhook', endpoint: 'https://example.com/hook', secretId: 'outbound' },
      ] },
    });
    const queued = service.queueRunAtomically(automation.id);
    const completed = { ...queued, status: 'succeeded' as const, currentPhase: 'completed' as const, endedAtMs: Date.now() };
    saveAutomationRun(completed);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const router = new AutomationDeliveryRouter({ fetch: fetchMock as typeof fetch });
    router.enqueue(completed, automation);

    expect(await router.dispatch()).toBe(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.redirect).toBe('manual');
    expect(headers['idempotency-key']).toBe(`${queued.id}:audit`);
    expect(headers['x-xopc-signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers['x-xopc-delivery-id']).toBeTruthy();
    vi.unstubAllEnvs();
  });

  it('accepts a registered card adapter without changing the router', async () => {
    const automation = await service.create({
      name: 'Card delivery', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'done' },
      delivery: { notificationPolicy: 'none', destinations: [
        { key: 'project-card', kind: 'card', channelId: 'project-1', templateId: 'summary-v1' },
      ] },
    });
    const queued = service.queueRunAtomically(automation.id);
    const completed = { ...queued, status: 'succeeded' as const, currentPhase: 'completed' as const, endedAtMs: Date.now() };
    saveAutomationRun(completed);
    const delivered: unknown[] = [];
    const router = new AutomationDeliveryRouter();
    router.register('card', async input => { delivered.push(input.result.artifacts); });
    router.enqueue(completed, automation, [
      { id: 'card-1', kind: 'card', schema: 'xopc.summary.v1', data: { title: 'Done' } },
    ]);

    expect(await router.dispatch()).toBe(1);
    expect(delivered).toEqual([[
      { id: 'card-1', kind: 'card', schema: 'xopc.summary.v1', data: { title: 'Done' } },
    ]]);
  });
});
