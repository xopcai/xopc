import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { AutomationService } from '../../service/automation-service.js';
import { ingestAutomationEvent, replayAutomationEvent } from '../event-repository.js';
import { AutomationEventDispatcher } from '../event-dispatcher.js';

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

  it('does not let a poison projection block later events and can replay its dead letter', async () => {
    ingestAutomationEvent({ id: 'poison', type: 'test.poison', source: 'test', payload: {} });
    ingestAutomationEvent({ id: 'healthy', type: 'test.healthy', source: 'test', payload: {} });
    const projected: string[] = [];
    const dispatcher = new AutomationEventDispatcher(service, {
      onEvent: (event) => {
        if (event.id === 'poison') throw new Error('bad projection');
        projected.push(event.id);
      },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await dispatcher.dispatch();
      getSqliteDatabase().prepare(`UPDATE automation_events SET projection_next_attempt_at_ms = 0
        WHERE event_id = 'poison'`).run();
    }
    expect(projected).toContain('healthy');
    expect(getSqliteDatabase().prepare(`SELECT projection_status FROM automation_events WHERE event_id = 'poison'`).get())
      .toEqual({ projection_status: 'dead_letter' });
    expect(replayAutomationEvent('poison')).toBe(true);
    expect(getSqliteDatabase().prepare(`SELECT projection_status FROM automation_events WHERE event_id = 'poison'`).get())
      .toEqual({ projection_status: 'retrying' });
  });

  it('prioritizes runnable work beyond the delivery scan budget', async () => {
    const busy = await service.create({
      id: 'busy', name: 'Busy', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'busy' },
    });
    const free = await service.create({
      id: 'free', name: 'Free', trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'free' },
    });
    service.queueRunAtomically(busy.id);
    for (let index = 0; index < 550; index += 1) {
      ingestAutomationEvent({ id: `busy-${index}`, type: 'test.busy', source: 'test', payload: {} },
        { targetAutomationIds: [busy.id] });
    }
    ingestAutomationEvent({ id: 'free-event', type: 'test.free', source: 'test', payload: {} },
      { targetAutomationIds: [free.id] });
    const dispatcher = new AutomationEventDispatcher(service);
    expect(await dispatcher.dispatch()).toBe(1);
    expect(getSqliteDatabase().prepare(`SELECT status FROM automation_event_deliveries
      WHERE event_id = 'free-event' AND automation_id = 'free'`).get()).toEqual({ status: 'queued' });
  });
});
