import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { claimNextRun, listInsights } from '../execution/repository.js';
import type { ProactiveAgentExecutor } from '../execution/types.js';
import { ProactiveWorker } from '../execution/worker.js';
import { ProactiveScenarioService } from '../scenarios/service.js';
import { ProactiveEventService } from '../service.js';

describe('proactive execution worker', () => {
  let stateDir: string;
  let scenarios: ProactiveScenarioService;
  let events: ProactiveEventService;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-proactive-execution-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    scenarios = new ProactiveScenarioService();
    scenarios.subscribe({ scenarioKey: 'blocked_work', workspaceId: 'default', scopeKind: 'project', scopeId: 'project-1', enabled: true });
    events = new ProactiveEventService(() => scenarios.routes());
  });

  afterEach(() => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(stateDir, { recursive: true, force: true });
  });

  function publishAndReady(): string {
    const result = events.publish({
      type: 'work_item.status_changed.v1', schemaVersion: 1,
      source: { kind: 'work_items', id: 'local' }, subject: { kind: 'work_item', id: 'work-1' },
      actor: { kind: 'user', id: 'user-1' }, scope: { workspaceId: 'default', projectId: 'project-1' },
      occurredAt: '2026-08-13T01:00:00.000Z', dedupeKey: 'work-1:blocked:1', sensitivity: 'personal',
      payload: { before: { status: 'todo' }, after: { status: 'blocked' } },
    }, new Date('2026-08-13T01:00:00.000Z'));
    events.markReadyBatches(new Date('2026-08-13T01:20:00.000Z'));
    return result.event.id;
  }

  it('creates an insight only when output is evidenced and clears the durable run', async () => {
    const eventId = publishAndReady();
    const executor: ProactiveAgentExecutor = { execute: async () => ({ text: JSON.stringify({
      title: 'Blocked launch task needs an owner decision', summary: 'The task changed to blocked.',
      whyNow: 'The status changed now.', impact: 'The project may miss its planned delivery.',
      recommendation: 'Assign an owner to resolve the blocker.', workDone: 'Inspected the status transition.', decision: null,
      urgency: 'high', confidence: 0.9, evidenceIds: [eventId],
    }), modelRef: 'test/model' }) };
    await new ProactiveWorker(executor).tick();
    expect(listInsights()).toHaveLength(1);
    expect(events.listBatches()[0]?.status).toBe('processed');
  });

  it('discards low-value output and retries fabricated evidence with a bounded policy', async () => {
    publishAndReady();
    const low: ProactiveAgentExecutor = { execute: async () => ({ text: JSON.stringify({
      title: 'Routine update', summary: 'Nothing material.', whyNow: 'A status changed.', impact: 'Low impact.',
      recommendation: 'No action.', workDone: 'Inspected the transition.', decision: null,
      urgency: 'low', confidence: 0.4, evidenceIds: [events.listEvents()[0]!.id],
    }) }) };
    await new ProactiveWorker(low).tick();
    expect(listInsights()).toEqual([]);
    expect(events.listBatches()[0]?.status).toBe('ignored');

    events.publish({ ...events.listEvents()[0]!, id: undefined, dedupeKey: 'work-1:blocked:2' } as never, new Date('2026-08-13T02:00:00.000Z'));
    events.markReadyBatches(new Date('2026-08-13T03:00:00.000Z'));
    const fake: ProactiveAgentExecutor = { execute: async () => ({ text: JSON.stringify({
      title: 'Fake', summary: 'Fake evidence.', whyNow: 'Now.', impact: 'Impact.', recommendation: 'Act.',
      workDone: 'Inspected evidence.', decision: null, urgency: 'critical', confidence: 1, evidenceIds: ['unknown'],
    }) }) };
    await new ProactiveWorker(fake).tick();
    expect(events.listBatches().some((batch) => batch.status === 'failed_retryable')).toBe(true);
  });

  it('permanently fails a run after three expired leases', () => {
    publishAndReady();
    expect(claimNextRun('worker-1', new Date('2026-08-13T01:20:00.000Z'), 1)?.attempt).toBe(1);
    expect(claimNextRun('worker-2', new Date('2026-08-13T01:20:02.000Z'), 1)?.attempt).toBe(2);
    expect(claimNextRun('worker-3', new Date('2026-08-13T01:20:04.000Z'), 1)?.attempt).toBe(3);

    expect(claimNextRun('worker-4', new Date('2026-08-13T01:20:06.000Z'), 1)).toBeNull();
    expect(events.listBatches()[0]?.status).toBe('failed_permanent');
  });
});
