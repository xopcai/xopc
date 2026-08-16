import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ContextProviderRegistry } from '../execution/context.js';
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
    for (const subscription of scenarios.subscriptions()) {
      scenarios.subscribe({
        scenarioKey: subscription.scenarioKey,
        workspaceId: subscription.workspaceId,
        scopeKind: subscription.scopeKind,
        scopeId: subscription.scopeId,
        enabled: false,
      });
    }
    scenarios.subscribe({ scenarioKey: 'blocked_work', workspaceId: 'default', scopeKind: 'project', scopeId: 'project-1', enabled: true });
    events = new ProactiveEventService(() => scenarios.routes());
  });

  afterEach(() => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(stateDir, { recursive: true, force: true });
  });

  function publishAndReady(dedupeKey = 'work-1:blocked:1', subjectId = 'work-1'): string {
    const result = events.publish({
      type: 'work_item.status_changed.v1', schemaVersion: 1,
      source: { kind: 'work_items', id: 'local' }, subject: { kind: 'work_item', id: subjectId },
      actor: { kind: 'user', id: 'user-1' }, scope: { workspaceId: 'default', projectId: 'project-1' },
      occurredAt: '2026-08-13T01:00:00.000Z', dedupeKey, sensitivity: 'personal',
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

  it('persists the snapshot-safe context instead of model-visible external content', async () => {
    const eventId = publishAndReady('work-1:blocked:snapshot');
    const contexts = new ContextProviderRegistry([{
      id: 'external_evidence',
      supports: () => true,
      collect: async () => ({
        content: { body: 'raw external body' },
        snapshotContent: { contentHash: 'hash-1' },
        evidenceIds: [eventId],
      }),
    }]);
    const executor: ProactiveAgentExecutor = { execute: async () => ({ text: JSON.stringify({
      title: 'Blocked task needs a decision',
      summary: 'The task is blocked.',
      whyNow: 'The status changed.',
      impact: 'Delivery may slip.',
      recommendation: 'Assign an owner.',
      workDone: 'Inspected the evidence.',
      decision: null,
      urgency: 'high',
      confidence: 0.9,
      evidenceIds: [eventId],
    }) }) };

    await new ProactiveWorker(executor, contexts).tick();

    const snapshot = getSqliteDatabase().prepare(
      'SELECT content_json FROM proactive_context_snapshots LIMIT 1',
    ).get() as { content_json: string };
    expect(snapshot.content_json).toContain('hash-1');
    expect(snapshot.content_json).not.toContain('raw external body');
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

  it('suppresses equivalent insights for the same subscription during the cooldown', async () => {
    const executor: ProactiveAgentExecutor = { execute: async ({ authorizedContext }) => {
      const eventBatch = authorizedContext.event_batch as { events: Array<{ evidenceId: string }> };
      return { text: JSON.stringify({
        title: 'Blocked launch task needs an owner decision',
        summary: 'The task remains blocked on the same decision.',
        whyNow: 'The blocking signal was observed again.',
        impact: 'The project may miss delivery.',
        recommendation: 'Assign an owner to resolve the blocker.',
        workDone: 'Inspected the latest evidence.',
        decision: null,
        urgency: 'high',
        confidence: 0.9,
        evidenceIds: [eventBatch.events[0]!.evidenceId],
      }) };
    } };
    publishAndReady('work-1:blocked:duplicate-1');
    await new ProactiveWorker(executor).tick();
    publishAndReady('work-1:blocked:duplicate-2');
    await new ProactiveWorker(executor).tick();

    expect(listInsights()).toHaveLength(1);
    expect(events.listBatches().some((batch) => batch.status === 'ignored')).toBe(true);
  });

  it('does not suppress equivalent wording for different subjects', async () => {
    const executor: ProactiveAgentExecutor = { execute: async ({ authorizedContext }) => {
      const eventBatch = authorizedContext.event_batch as { events: Array<{ evidenceId: string }> };
      return { text: JSON.stringify({
        title: 'Blocked task needs an owner decision',
        summary: 'The task remains blocked on an owner decision.',
        whyNow: 'A new blocking signal was observed.',
        impact: 'Delivery may slip.',
        recommendation: 'Assign an owner to resolve the blocker.',
        workDone: 'Inspected the latest evidence.',
        decision: null,
        urgency: 'high',
        confidence: 0.9,
        evidenceIds: [eventBatch.events[0]!.evidenceId],
      }) };
    } };
    publishAndReady('work-1:blocked:subject-1', 'work-1');
    await new ProactiveWorker(executor).tick();
    publishAndReady('work-2:blocked:subject-2', 'work-2');
    await new ProactiveWorker(executor).tick();

    expect(listInsights()).toHaveLength(2);
  });
});
