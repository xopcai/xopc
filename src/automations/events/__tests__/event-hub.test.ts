import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { AutomationService } from '../../service/automation-service.js';
import { ingestAutomationEvent } from '../event-repository.js';

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  expect(predicate()).toBe(true);
}

describe('automation event hub', () => {
  let directory: string;
  let service: AutomationService;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'xopc-event-hub-'));
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

  it('deduplicates identical events and rejects identity reuse with different content', () => {
    const event = {
      id: 'event-1', type: 'task.changed', source: 'tasks', dedupeKey: 'change-1',
      occurredAtMs: 100, payload: { taskId: 'task-1' },
    };
    expect(ingestAutomationEvent(event).created).toBe(true);
    expect(ingestAutomationEvent(event).created).toBe(false);
    expect(() => ingestAutomationEvent({ ...event, payload: { taskId: 'task-2' } }))
      .toThrow('identity reused with different content');
  });

  it('keeps per-automation deliveries pending while concurrency is full', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>(resolve => { releaseFirst = resolve; });
    let calls = 0;
    service.setDeps({ agentService: { turnDispatcher: {
      processDirect: async () => {
        calls += 1;
        if (calls === 1) await firstBlocked;
        return `completed-${calls}`;
      },
    } } });
    for (const id of ['one', 'two']) {
      await service.create({
        id, name: id, trigger: { kind: 'event', eventType: 'task.ready', source: 'tasks' },
        action: { kind: 'agent', instruction: `run ${id}` },
      });
    }
    await service.initialize({ maxConcurrentRuns: 1 });
    service.ingestEvent({ id: 'ready-1', type: 'task.ready', source: 'tasks', payload: { taskId: 'task-1' } });
    await waitUntil(() => calls === 1);
    const pending = getSqliteDatabase().prepare(
      "SELECT count(*) AS count FROM automation_event_deliveries WHERE event_id = 'ready-1' AND status = 'pending'",
    ).get() as { count: number };
    expect(pending.count).toBe(1);
    releaseFirst();
    await waitUntil(() => calls === 2);
    await waitUntil(() => {
      const row = getSqliteDatabase().prepare(
        "SELECT count(*) AS count FROM automation_event_deliveries WHERE event_id = 'ready-1' AND status = 'completed'",
      ).get() as { count: number };
      return row.count === 2;
    });
  });
});
