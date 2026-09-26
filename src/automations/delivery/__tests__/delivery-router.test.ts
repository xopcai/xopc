import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { AutomationService } from '../../service/automation-service.js';
import { saveAutomationRun } from '../../storage/index.js';
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
});
